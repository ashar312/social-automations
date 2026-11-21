'use strict';
const { Op } = require('sequelize');
const { PlatformAccount, Project } = require('../db/models');
const { encrypt, decrypt } = require('./crypto');

async function upsertAccount(projectId, platform, d) {
  const values = {
    project_id: projectId,
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
  const existing = await PlatformAccount.findOne({ where: { project_id: projectId, platform } });
  let row;
  if (existing) {
    // keep the old refresh token if the provider didn't send a new one
    if (!values.refresh_token_enc) values.refresh_token_enc = existing.refresh_token_enc;
    row = await existing.update(values);
  } else {
    row = await PlatformAccount.create(values);
  }
  await syncSiblings(row);
  return row;
}

/**
 * The same account (platform + external_id) can be connected in several projects, one row each.
 * Copy token fields and status from `row` to the others, so a reconnect or refresh in one project covers all.
 */
/** Ids of every project owned by the same user as `projectId` (accounts are never shared across users). */
async function sameUserProjectIds(projectId) {
  const p = await Project.findByPk(projectId, { attributes: ['user_id'] });
  if (!p) return [];
  return (await Project.findAll({ where: { user_id: p.user_id }, attributes: ['id'] })).map((x) => x.id);
}

async function syncSiblings(row) {
  const [n] = await PlatformAccount.update({
    access_token_enc: row.access_token_enc,
    refresh_token_enc: row.refresh_token_enc,
    token_expires_at: row.token_expires_at,
    scopes: row.scopes,
    status: row.status,
    last_checked_at: row.last_checked_at,
  }, { where: { platform: row.platform, external_id: row.external_id, id: { [Op.ne]: row.id }, project_id: await sameUserProjectIds(row.project_id) } });
  return n;
}

/** Names of the other projects that use the same account, keyed by account id. */
async function sharedWithMap(rows) {
  const out = new Map();
  for (const r of rows) {
    const sibs = await PlatformAccount.findAll({
      where: { platform: r.platform, external_id: r.external_id, id: { [Op.ne]: r.id }, project_id: await sameUserProjectIds(r.project_id) },
      include: [{ model: Project, as: 'project', attributes: ['name'] }],
    });
    out.set(r.id, sibs.map((x) => x.project.name));
  }
  return out;
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

function publicView(acc, sharedWith = []) {
  // YouTube's stored expiry is the 1-hour access token; the refresh token renews it on use,
  // so that expiry says nothing about whether the connection still works.
  const refreshable = acc.platform === 'youtube' && acc.refresh_token_enc;
  const exp = !refreshable && acc.token_expires_at ? new Date(acc.token_expires_at) : null;
  return {
    projectId: acc.project_id,
    platform: acc.platform,
    sharedWith,
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
module.exports = { upsertAccount, syncSiblings, sharedWithMap, open, publicView };
