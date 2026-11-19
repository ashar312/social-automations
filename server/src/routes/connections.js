'use strict';
const express = require('express');
const { PlatformAccount, Project } = require('../db/models');
const { publicView, sharedWithMap } = require('../services/accounts');
const { testAccount } = require('../services/tokens');

const PLATFORMS = PlatformAccount.PLATFORMS;

// ---- global: GET /api/connections/alerts (all active projects) ----
const global = express.Router();
global.get('/alerts', async (req, res, next) => {
  try {
    const rows = await PlatformAccount.findAll({ include: [{ model: Project, as: 'project', where: { archived_at: null } }] });
    const alerts = [];
    for (const r of rows) {
      const v = publicView(r);
      let level = null;
      if (v.status === 'expired') level = 'error';
      else if (v.status === 'error') level = 'warn';
      else if (v.daysLeft != null && v.daysLeft < 7) level = 'warn';
      if (level) alerts.push({ level, projectId: r.project_id, projectName: r.project.name, platform: r.platform, status: v.status, daysLeft: v.daysLeft });
    }
    res.json({ ok: true, alerts });
  } catch (e) { next(e); }
});

// ---- scoped: /api/projects/:projectId/connections ----
const scoped = express.Router({ mergeParams: true });
const mine = (req, platform) => ({ project_id: req.project.id, ...(platform ? { platform } : {}) });
const okPlatform = (req, res) => {
  if (PLATFORMS.includes(req.params.platform)) return true;
  res.status(404).json({ ok: false, error: 'Unknown platform' });
  return false;
};

scoped.get('/', async (req, res, next) => {
  try {
    const rows = await PlatformAccount.findAll({ where: mine(req) });
    const shared = await sharedWithMap(rows);
    const by = Object.fromEntries(rows.map((r) => [r.platform, publicView(r, shared.get(r.id))]));
    res.json({ ok: true, connections: PLATFORMS.map((p) => by[p] || { platform: p, projectId: req.project.id, status: 'disconnected' }) });
  } catch (e) { next(e); }
});

scoped.post('/:platform/test', async (req, res, next) => {
  try {
    if (!okPlatform(req, res)) return;
    const acc = await PlatformAccount.findOne({ where: mine(req, req.params.platform) });
    if (!acc) return res.status(404).json({ ok: false, error: 'Not connected' });
    const r = await testAccount(acc);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { next(e); }
});

// Removes only this project's row; other projects using the same account keep theirs.
scoped.delete('/:platform', async (req, res, next) => {
  try {
    if (!okPlatform(req, res)) return;
    const n = await PlatformAccount.destroy({ where: mine(req, req.params.platform) });
    res.json({ ok: true, removed: n });
  } catch (e) { next(e); }
});

module.exports = { global, scoped };
