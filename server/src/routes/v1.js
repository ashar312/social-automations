'use strict';
/**
 * External API (v1) for other systems. Every call is scoped to ONE project:
 *   /api/v1/projects/:projectId/...   where :projectId is the project's public id (prj_xxx)
 *   Authorization: Bearer <that project's API key>
 * The key alone identifies the project; the id in the URL must match it (guards against posting to the wrong brand).
 * Guide: plans/guides/api.md
 */
const express = require('express');
const { Op } = require('sequelize');
const { PlatformAccount, Post, MediaFile } = require('../db/models');
const apiAuth = require('../middleware/apiAuth');
const { publicView } = require('../services/accounts');
const { PLATFORMS } = require('../services/posts');
const { RULES } = require('../platforms/rules');
const { handleUpload, importFromUrl } = require('./media');
const { handlers: h } = require('./posts');

const v1 = express.Router();
const project = express.Router({ mergeParams: true });

const projectView = (p, accounts) => {
  const by = Object.fromEntries(accounts.map((a) => [a.platform, a]));
  return {
    id: p.public_id, name: p.name, description: p.description, color: p.color, icon: p.icon,
    settings: p.settings || {},
    connections: PLATFORMS.map((pl) => {
      const a = by[pl];
      if (!a) return { platform: pl, connected: false };
      const v = publicView(a);
      return { platform: pl, connected: v.status !== 'expired', status: v.status, accountName: v.displayName, accountId: v.externalId, expiresAt: v.expiresAt };
    }),
  };
};

// GET /api/v1/me : which project does this key belong to? (no project id needed in the URL)
v1.get('/me', apiAuth, async (req, res, next) => {
  try {
    const accounts = await PlatformAccount.findAll({ where: { project_id: req.project.id } });
    res.json({ ok: true, project: projectView(req.project, accounts) });
  } catch (e) { next(e); }
});

// GET /api/v1/rules : platform limits (caption length, durations, sizes)
v1.get('/rules', (req, res) => res.json({ ok: true, rules: RULES }));

v1.use('/projects/:projectId', apiAuth, project);

project.get('/', async (req, res, next) => {
  try {
    const accounts = await PlatformAccount.findAll({ where: { project_id: req.project.id } });
    res.json({ ok: true, project: projectView(req.project, accounts) });
  } catch (e) { next(e); }
});

// ---- media ----
// multipart/form-data with field "file", or JSON { "url": "https://...", "name"?: "clip.mp4" }
project.post('/media', (req, res, next) => {
  if (!req.is('application/json')) return next();
  if (!req.body || typeof req.body.url !== 'string') return res.status(400).json({ ok: false, error: 'Send multipart field "file", or JSON { "url": "https://..." }' });
  importFromUrl(req.body.url, typeof req.body.name === 'string' ? req.body.name : undefined)
    .then((m) => res.json({ ok: true, ...m }))
    .catch(next);
}, handleUpload);

// ---- posts ----
/** Media used by an API post must still be unattached (uploaded but not yet in a post). */
async function freeMediaOnly(req, res, next) {
  try {
    if (req.body && req.body.alsoProjects && req.body.alsoProjects.length) {
      return res.status(400).json({ ok: false, error: 'alsoProjects is not available in the API. Call each project with its own key.' });
    }
    if (req.body) delete req.body.alsoProjects;
    const ids = Array.isArray(req.body && req.body.mediaIds) ? req.body.mediaIds.filter(Number.isInteger) : [];
    if (ids.length) {
      const used = await MediaFile.findAll({ where: { id: ids, post_id: { [Op.ne]: null } }, attributes: ['id'] });
      if (used.length) return res.status(400).json({ ok: false, error: `Media already used by another post: ${used.map((m) => m.id).join(', ')}. Upload it again.` });
    }
    next();
  } catch (e) { next(e); }
}

/** :id must be a post of this project. */
async function ownPost(req, res, next) {
  try {
    const p = /^\d+$/.test(req.params.id) ? await Post.findByPk(Number(req.params.id), { attributes: ['id', 'project_id'] }) : null;
    if (!p || p.project_id !== req.project.id) return res.status(404).json({ ok: false, error: 'Post not found in this project' });
    next();
  } catch (e) { next(e); }
}

project.post('/posts/validate', freeMediaOnly, h.validate);
project.post('/posts', freeMediaOnly, h.create);
project.get('/posts', h.list);
project.get('/posts/:id', ownPost, h.detail);
project.post('/posts/:id/targets/:platform/retry', ownPost, h.retry);
project.delete('/posts/:id', ownPost, h.remove);

module.exports = v1;
