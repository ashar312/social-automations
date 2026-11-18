'use strict';
const { PlatformAccount } = require('../db/models');
const { encrypt, decrypt } = require('./crypto');

async function upsertAccount(platform, d) {
  const values = {
    platform,
    external_id: d.externalId,
    display_name: d.displayName,
    avatar_url: d.avatarUrl || null,
    access_token_enc: encrypt(d.accessToken),
    refresh_token_enc: d.refreshToken ? encrypt(d.refreshToken) : null,
    token_expires_at: d.expiresAt || null,
    scopes: d.scopes || '',
    meta: d.meta || null,
    status: 'connected',
    last_checked_at: new Date(),
  };
  const existing = await PlatformAccount.findOne({ where: { platform } });
  if (existing) {
    // keep the old refresh token if the provider didn't send a new one
    if (!values.refresh_token_enc) values.refresh_token_enc = existing.refresh_token_enc;
    return existing.update(values);
  }
  return PlatformAccount.create(values);
}

/** Decrypted view for adapters. */
function open(acc) {
  return {
    id: acc.id,
    platform: acc.platform,
    externalId: acc.external_id,
    displayName: acc.display_name,
    accessToken: decrypt(acc.access_token_enc),
    refreshToken: acc.refresh_token_enc ? decrypt(acc.refresh_token_enc) : null,
    expiresAt: acc.token_expires_at,
    meta: acc.meta || {},
    model: acc,
  };
}

function publicView(acc) {
  const exp = acc.token_expires_at ? new Date(acc.token_expires_at) : null;
  return {
    platform: acc.platform,
    displayName: acc.display_name,
    avatarUrl: acc.avatar_url,
    externalId: acc.external_id,
    status: exp && exp < new Date() ? 'expired' : acc.status,
    expiresAt: exp,
    daysLeft: exp ? Math.floor((exp - Date.now()) / 86400000) : null,
    lastCheckedAt: acc.last_checked_at,
    scopes: acc.scopes,
  };
}
module.exports = { upsertAccount, open, publicView };
