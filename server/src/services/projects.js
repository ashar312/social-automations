'use strict';
const { PlatformAccount } = require('../db/models');
const { publicView } = require('./accounts');
const { PLATFORMS } = require('./posts');

/** External view of a project (external API /me and MCP get_project): settings + per-platform connection status. */
async function projectView(project) {
  const accounts = await PlatformAccount.findAll({ where: { project_id: project.id } });
  const by = Object.fromEntries(accounts.map((a) => [a.platform, a]));
  return {
    id: project.public_id, name: project.name, description: project.description, color: project.color, icon: project.icon,
    settings: project.settings || {},
    connections: PLATFORMS.map((pl) => {
      const a = by[pl];
      if (!a) return { platform: pl, connected: false };
      const v = publicView(a);
      return { platform: pl, connected: v.status !== 'expired', status: v.status, accountName: v.displayName, accountId: v.externalId, expiresAt: v.expiresAt };
    }),
  };
}

module.exports = { projectView };
