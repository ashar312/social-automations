'use strict';
/** Social sign-in (identity only, no posting tokens are stored). LinkedIn is live; Facebook / Instagram are flagged off. */
const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');
const env = require('../config/env');
const { User, UserIdentity } = require('../db/models');
const { httpErr, rand } = require('./auth');

const providers = {
  linkedin: {
    enabled: () => env.AUTH_LINKEDIN_ENABLED && !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
    // LinkedIn returns email_verified, so rule 3 (auto-link) may apply
    trustsEmail: true,
    authUrl(state, nonce) {
      return 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
        response_type: 'code', client_id: env.LINKEDIN_CLIENT_ID, redirect_uri: env.AUTH_LINKEDIN_REDIRECT_URI,
        state, nonce, scope: 'openid profile email',
      });
    },
    async profile(code) {
      const { data: t } = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: env.AUTH_LINKEDIN_REDIRECT_URI,
        client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const { data: me } = await axios.get('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
      return {
        id: String(me.sub), email: me.email ? String(me.email).toLowerCase() : null,
        emailVerified: me.email_verified === true || me.email_verified === 'true',
        name: me.name || [me.given_name, me.family_name].filter(Boolean).join(' ') || null, avatar: me.picture || null,
      };
    },
  },
  facebook: {
    enabled: () => env.AUTH_FACEBOOK_ENABLED && !!(env.META_APP_ID && env.META_APP_SECRET),
    // Facebook does not say whether the email is verified, so it is never used to auto-link
    trustsEmail: false,
    authUrl(state) {
      return `https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth?` + new URLSearchParams({
        client_id: env.META_APP_ID, redirect_uri: env.AUTH_FACEBOOK_REDIRECT_URI, state, scope: 'email,public_profile',
      });
    },
    async profile(code) {
      const g = (p, params) => axios.get(`https://graph.facebook.com/${env.META_GRAPH_VERSION}${p}`, { params }).then((r) => r.data);
      const t = await g('/oauth/access_token', { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: env.AUTH_FACEBOOK_REDIRECT_URI, code });
      const me = await g('/me', { access_token: t.access_token, fields: 'id,name,email,picture.type(large)' });
      return { id: String(me.id), email: me.email ? String(me.email).toLowerCase() : null, emailVerified: false, name: me.name || null, avatar: me.picture?.data?.url || null };
    },
  },
  instagram: {
    enabled: () => env.AUTH_INSTAGRAM_ENABLED && !!(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET),
    trustsEmail: false,
    // Business/Creator accounts only, and Instagram returns no email: new users finish sign-up with one
    authUrl(state) {
      return 'https://www.instagram.com/oauth/authorize?' + new URLSearchParams({
        client_id: env.INSTAGRAM_APP_ID, redirect_uri: env.AUTH_INSTAGRAM_REDIRECT_URI, response_type: 'code', state, scope: 'instagram_business_basic',
      });
    },
    async profile(code) {
      const { data: t } = await axios.post('https://api.instagram.com/oauth/access_token', new URLSearchParams({
        client_id: env.INSTAGRAM_APP_ID, client_secret: env.INSTAGRAM_APP_SECRET, grant_type: 'authorization_code',
        redirect_uri: env.AUTH_INSTAGRAM_REDIRECT_URI, code,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const { data: me } = await axios.get('https://graph.instagram.com/me', { params: { fields: 'user_id,username,name,profile_picture_url', access_token: t.access_token } });
      return { id: String(me.user_id || t.user_id), email: null, emailVerified: false, name: me.name || me.username || null, avatar: me.profile_picture_url || null };
    },
  },
};

const LABEL = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram' };

// Instagram "finish sign-up": the profile waits here (10 min) until the user types an email
const pending = new Map();
function stashPending(prof) {
  const id = crypto.randomBytes(16).toString('hex');
  pending.set(id, { prof, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 600000) pending.delete(k);
  return id;
}
const takePending = (id) => {
  const v = pending.get(id);
  if (!v || Date.now() - v.at > 600000) { pending.delete(id); return null; }
  return v.prof;
};
const dropPending = (id) => pending.delete(id);
/** Creates the account for a pending provider profile with the typed email (unverified). */
async function finishSignup(provider, prof, email) {
  if (await User.findOne({ where: { email } })) {
    throw httpErr(409, `An account with this email exists. Sign in with your password, then link ${LABEL[provider]} in Settings.`);
  }
  const user = await User.create({ email, name: (prof.name || email.split('@')[0]).slice(0, 100), avatar_url: prof.avatar ? prof.avatar.slice(0, 1000) : null, password_hash: null });
  await UserIdentity.create({ user_id: user.id, provider, provider_user_id: prof.id, email });
  return user;
}

const get = (name) => providers[name] && providers[name].enabled() ? providers[name] : null;

/**
 * Applies the resolution rules. Returns { user, linked } or throws httpErr (message shown on /login).
 * `mode` is 'login' or 'link'; `linkUser` is the signed-in user for 'link'.
 */
async function resolveUser(provider, prof, { mode, linkUser }) {
  const P = providers[provider];
  const existing = await UserIdentity.findOne({ where: { provider, provider_user_id: prof.id } });
  if (mode === 'link') {
    if (existing && existing.user_id !== linkUser.id) throw httpErr(409, 'That account is already linked to another user');
    if (!existing) {
      if (await UserIdentity.findOne({ where: { user_id: linkUser.id, provider } })) throw httpErr(409, 'You already linked a different account for this provider');
      await UserIdentity.create({ user_id: linkUser.id, provider, provider_user_id: prof.id, email: prof.email });
    }
    return { user: linkUser, linked: true };
  }
  if (existing) {
    const user = await User.findByPk(existing.user_id);
    if (!user || user.disabled_at) throw httpErr(403, 'This account is disabled');
    return { user };
  }
  if (prof.email) {
    const byEmail = await User.findOne({ where: { email: prof.email } });
    if (byEmail) {
      if (byEmail.disabled_at) throw httpErr(403, 'This account is disabled');
      if (P.trustsEmail && prof.emailVerified && byEmail.email_verified_at) {
        await UserIdentity.create({ user_id: byEmail.id, provider, provider_user_id: prof.id, email: prof.email });
        return { user: byEmail };
      }
      throw httpErr(409, 'An account with this email exists. Sign in with your password, then link ' + LABEL[provider] + ' in Settings.');
    }
  }
  if (!prof.email) return { needsEmail: true, prof };
  const user = await User.create({
    email: prof.email, name: (prof.name || prof.email.split('@')[0]).slice(0, 100), avatar_url: prof.avatar ? prof.avatar.slice(0, 1000) : null,
    password_hash: null, email_verified_at: P.trustsEmail && prof.emailVerified ? new Date() : null,
  });
  await UserIdentity.create({ user_id: user.id, provider, provider_user_id: prof.id, email: prof.email });
  return { user, created: true };
}

async function purgeStates(AuthOAuthState) {
  await AuthOAuthState.destroy({ where: { created_at: { [Op.lt]: new Date(Date.now() - 600000) } } });
}

module.exports = { dropPending, LABEL, stashPending, takePending, finishSignup, get, resolveUser, purgeStates, newState: () => crypto.randomBytes(32).toString('hex'), nonce: () => rand().slice(0, 32) };
