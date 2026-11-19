'use strict';
const axios = require('axios');
const { google } = require('googleapis');
const env = require('../config/env');
const { open, syncSiblings } = require('./accounts');
const { encrypt } = require('./crypto');
const { PublishError, fromHttp } = require('./errors');

const GRAPH = () => `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;

function googleClient(acc) {
  const c = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  c.setCredentials({
    access_token: acc.accessToken,
    refresh_token: acc.refreshToken,
    expiry_date: acc.expiresAt ? new Date(acc.expiresAt).getTime() : undefined,
  });
  // persist refreshed tokens
  c.on('tokens', async (t) => {
    const patch = {};
    if (t.access_token) patch.access_token_enc = encrypt(t.access_token);
    if (t.refresh_token) patch.refresh_token_enc = encrypt(t.refresh_token);
    if (t.expiry_date) patch.token_expires_at = new Date(t.expiry_date);
    if (Object.keys(patch).length) {
      await acc.model.update({ ...patch, status: 'connected' });
      await syncSiblings(acc.model);
    }
  });
  return c;
}

/**
 * Make sure the account can be used right now. Throws PublishError({reconnect}) if not.
 * Returns the decrypted account.
 */
async function ensureFresh(model) {
  const acc = open(model);
  if (acc.expiresAt && new Date(acc.expiresAt) < new Date() && acc.platform !== 'youtube') {
    await model.update({ status: 'expired' });
    await syncSiblings(model);
    throw new PublishError(`${acc.platform} token expired. Reconnect the account on the Connections page.`, { reconnect: true });
  }
  return acc;
}

/** Cheap read-only call to verify the token still works. */
async function testAccount(model) {
  const acc = open(model);
  try {
    let label;
    if (acc.platform === 'linkedin') {
      const { data } = await axios.get('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${acc.accessToken}` } });
      label = data.name;
    } else if (acc.platform === 'youtube') {
      const yt = google.youtube({ version: 'v3', auth: googleClient(acc) });
      const { data } = await yt.channels.list({ part: ['snippet'], mine: true });
      label = data.items?.[0]?.snippet?.title;
    } else if (acc.platform === 'facebook') {
      const { data } = await axios.get(`${GRAPH()}/${acc.externalId}`, { params: { access_token: acc.accessToken, fields: 'name' } });
      label = data.name;
    } else {
      const { data } = await axios.get(`${GRAPH()}/${acc.externalId}`, { params: { access_token: acc.accessToken, fields: 'username' } });
      label = data.username;
    }
    await model.update({ status: 'connected', last_checked_at: new Date() });
    await syncSiblings(model);
    return { ok: true, message: `Token works${label ? ` (${label})` : ''}` };
  } catch (e) {
    const err = fromHttp(e);
    const invalid = err.reconnect || e.message === 'invalid_grant' || e.response?.data?.error === 'invalid_grant';
    await model.update({ status: invalid ? 'expired' : 'error' });
    await syncSiblings(model);
    return { ok: false, error: invalid ? 'Token is invalid or revoked. Reconnect the account.' : err.message };
  }
}

module.exports = { ensureFresh, testAccount, googleClient, GRAPH };
