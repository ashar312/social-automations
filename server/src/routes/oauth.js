'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const axios = require('axios');
const { google } = require('googleapis');
const { Op } = require('sequelize');
const env = require('../config/env');
const { OAuthState, Project, PlatformAccount } = require('../db/models');
const { upsertAccount } = require('../services/accounts');

const clientDone = (q, projectId) => `${env.CLIENT_URL}/connections?${new URLSearchParams(projectId ? { ...q, project: String(projectId) } : q)}`;
const GV = env.META_GRAPH_VERSION;
const b64url = (b) => b.toString('base64url');

// ---- Meta page-picker state (kept in memory, 10 min) ----
const pending = new Map();
function stash(data) {
  const id = crypto.randomBytes(16).toString('hex');
  pending.set(id, { ...data, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 600000) pending.delete(k);
  return id;
}

async function saveMetaPage(ctx, pageId) {
  const page = ctx.pages.find((p) => p.id === pageId);
  if (!page) throw Object.assign(new Error('Unknown page'), { status: 400 });
  const { data: info } = await axios.get(`https://graph.facebook.com/${GV}/${page.id}`, {
    params: { access_token: page.access_token, fields: 'instagram_business_account{id,username,profile_picture_url}' },
  });
  await upsertAccount(ctx.projectId, 'facebook', {
    externalId: page.id, displayName: page.name, avatarUrl: page.picture?.data?.url,
    accessToken: page.access_token, scopes: ctx.scopes, meta: { pageId: page.id },
  });
  const ig = info.instagram_business_account;
  if (ig) {
    await upsertAccount(ctx.projectId, 'instagram', {
      externalId: ig.id, displayName: ig.username || page.name, avatarUrl: ig.profile_picture_url,
      accessToken: page.access_token, scopes: ctx.scopes, meta: { pageId: page.id, igUserId: ig.id },
    });
  }
  return { facebook: true, instagram: !!ig };
}

const providers = {
  linkedin: {
    configured: () => env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET,
    authUrl(state) {
      return 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
        response_type: 'code', client_id: env.LINKEDIN_CLIENT_ID, redirect_uri: env.LINKEDIN_REDIRECT_URI,
        state, scope: 'openid profile email w_member_social',
      });
    },
    async callback(code, verifier, projectId) {
      const { data: t } = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: env.LINKEDIN_REDIRECT_URI,
        client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const { data: me } = await axios.get('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
      await upsertAccount(projectId, 'linkedin', {
        externalId: `urn:li:person:${me.sub}`, displayName: me.name || me.email || me.sub, avatarUrl: me.picture,
        accessToken: t.access_token, refreshToken: t.refresh_token,
        expiresAt: new Date(Date.now() + (t.expires_in || 5184000) * 1000),
        scopes: t.scope || 'openid profile email w_member_social',
      });
      return { connected: 'linkedin' };
    },
  },

  youtube: {
    pkce: true,
    configured: () => env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
    client: () => new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI),
    authUrl(state, verifier) {
      return this.client().generateAuthUrl({
        access_type: 'offline', prompt: 'consent select_account', state, include_granted_scopes: true,
        scope: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
        code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
      });
    },
    async callback(code, verifier, projectId) {
      const c = this.client();
      const { tokens } = await c.getToken({ code, codeVerifier: verifier });
      c.setCredentials(tokens);
      const yt = google.youtube({ version: 'v3', auth: c });
      const { data } = await yt.channels.list({ part: ['snippet'], mine: true });
      const ch = data.items && data.items[0];
      if (!ch) throw new Error('No YouTube channel found on this Google account');
      await upsertAccount(projectId, 'youtube', {
        externalId: ch.id, displayName: ch.snippet.title, avatarUrl: ch.snippet.thumbnails?.default?.url,
        accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null, scopes: tokens.scope,
      });
      return { connected: 'youtube' };
    },
  },

  meta: {
    configured: () => env.META_APP_ID && env.META_APP_SECRET,
    authUrl(state) {
      return `https://www.facebook.com/${GV}/dialog/oauth?` + new URLSearchParams({
        client_id: env.META_APP_ID, redirect_uri: env.META_REDIRECT_URI, state,
        scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management',
      });
    },
    async callback(code, verifier, projectId) {
      const g = (p, params) => axios.get(`https://graph.facebook.com/${GV}${p}`, { params }).then((r) => r.data);
      const short = await g('/oauth/access_token', {
        client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: env.META_REDIRECT_URI, code,
      });
      const long = await g('/oauth/access_token', {
        grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET,
        fb_exchange_token: short.access_token,
      });
      const pages = (await g('/me/accounts', {
        access_token: long.access_token, fields: 'id,name,access_token,picture{url}', limit: 100,
      })).data || [];
      if (!pages.length) throw new Error('No Facebook Pages found for this user');
      const scopes = 'pages_show_list pages_read_engagement pages_manage_posts instagram_basic instagram_content_publish business_management';
      const ctx = { pages, scopes, projectId };
      if (pages.length === 1) {
        await saveMetaPage(ctx, pages[0].id);
        return { connected: 'facebook,instagram' };
      }
      return { pick: 'meta', sel: stash(ctx) };
    },
  },
};

router.get('/:platform/start', async (req, res, next) => {
  try {
    const p = providers[req.params.platform];
    if (!p) return res.status(404).json({ ok: false, error: 'Unknown platform' });
    const projectId = /^\d+$/.test(String(req.query.project || '')) ? Number(req.query.project) : null;
    const project = projectId && await Project.findByPk(projectId);
    if (!project || project.archived_at) return res.status(400).json({ ok: false, error: 'Pick an active project first (?project=<id>)' });
    if (!p.configured()) return res.redirect(clientDone({ error: `${req.params.platform} credentials are missing in server/.env` }, project.id));
    await OAuthState.destroy({ where: { created_at: { [Op.lt]: new Date(Date.now() - 600000) } } });
    const state = crypto.randomBytes(32).toString('hex');
    const verifier = p.pkce ? b64url(crypto.randomBytes(48)) : null;
    await OAuthState.create({ state, platform: req.params.platform, code_verifier: verifier, project_id: project.id });
    res.redirect(p.authUrl(state, verifier));
  } catch (e) { next(e); }
});

router.get('/:platform/callback', async (req, res) => {
  const platform = req.params.platform;
  const p = providers[platform];
  let projectId = null;
  try {
    if (!p) throw new Error('Unknown platform');
    if (req.query.error) throw new Error(req.query.error_description || req.query.error);
    const row = await OAuthState.findOne({ where: { state: String(req.query.state || ''), platform } });
    if (!row) throw new Error('Invalid OAuth state, please try connecting again');
    projectId = row.project_id;
    await row.destroy();
    if (Date.now() - new Date(row.created_at).getTime() > 600000) throw new Error('OAuth state expired, please try again');
    const out = await p.callback(String(req.query.code), row.code_verifier, projectId);
    res.redirect(clientDone(out, projectId));
  } catch (e) {
    const msg = e.response?.data?.error_description || e.response?.data?.error?.message || e.message;
    console.error(`OAuth ${platform} failed:`, msg);
    res.redirect(clientDone({ error: msg }, projectId));
  }
});

// Meta page picker (when the user manages more than one Page)
router.get('/meta/pages', async (req, res, next) => {
  try {
  const s = pending.get(String(req.query.sel));
  if (!s) return res.status(404).json({ ok: false, error: 'Selection expired, reconnect' });
  res.json({ ok: true, pages: await Promise.all(s.pages.map(async (p) => ({
    id: p.id, name: p.name,
    usedIn: (await PlatformAccount.findAll({ where: { platform: 'facebook', external_id: p.id, project_id: { [Op.ne]: s.projectId } }, include: [{ model: Project, as: 'project', attributes: ['name'] }] })).map((a) => a.project.name),
  }))) });
  } catch (e) { next(e); }
});
router.post('/meta/select', async (req, res, next) => {
  try {
    const s = pending.get(String(req.body.sel));
    if (!s) return res.status(404).json({ ok: false, error: 'Selection expired, reconnect' });
    const r = await saveMetaPage(s, String(req.body.pageId));
    pending.delete(String(req.body.sel));
    res.json({ ok: true, ...r });
  } catch (e) { next(e); }
});

module.exports = router;
