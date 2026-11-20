'use strict';
/**
 * External API (v1) for other systems. Every call is scoped to ONE project:
 *   /api/v1/projects/:projectId/...   where :projectId is the project's public id (prj_xxx)
 *   Authorization: Bearer <that project's API key>
 * The key alone identifies the project; the id in the URL must match it (guards against posting to the wrong brand).
 * The logic is shared with the UI routes and the MCP server (services/*).
 * Guide: plans/guides/api.md
 */
const express = require('express');
const apiAuth = require('../middleware/apiAuth');
const { RULES } = require('../platforms/rules');
const { handleUpload } = require('./media');
const { importFromUrl } = require('../services/media');
const { projectView } = require('../services/projects');
const svc = require('../services/posts');

const v1 = express.Router();
const project = express.Router({ mergeParams: true });

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) { next(e); }
};
const API = { api: true, via: 'api' };

// GET /api/v1/me : which project does this key belong to? (no project id needed in the URL)
v1.get('/me', apiAuth, wrap(async (req, res) => res.json({ ok: true, project: await projectView(req.project) })));

// GET /api/v1/rules : platform limits (caption length, durations, sizes)
v1.get('/rules', (req, res) => res.json({ ok: true, rules: RULES }));

v1.use('/projects/:projectId', apiAuth, project);

project.get('/', wrap(async (req, res) => res.json({ ok: true, project: await projectView(req.project) })));

// ---- media ----
// multipart/form-data with field "file", or JSON { "url": "https://...", "name"?: "clip.mp4" }
project.post('/media', (req, res, next) => {
  if (!req.is('application/json')) return next();
  if (!req.body || typeof req.body.url !== 'string') return res.status(400).json({ ok: false, error: 'Send multipart field "file", or JSON { "url": "https://..." }' });
  importFromUrl(req.body.url, typeof req.body.name === 'string' ? req.body.name : undefined, { projectId: req.project.id })
    .then((m) => res.json({ ok: true, ...m }))
    .catch(next);
}, handleUpload);

// JSON { mediaIds: [2-20 image ids], size?, fit?, background?, name? } → a PDF media row (kind "document")
project.post('/media/carousel', wrap(async (req, res) => {
  const { buildCarousel } = require('../services/carousel');
  res.json({ ok: true, ...(await buildCarousel(req.body, { projectId: req.project.id, api: true })) });
}));

// ---- posts ----
project.post('/posts/validate', wrap(async (req, res) => {
  res.json({ ok: true, ...(await svc.validatePost(req.project, req.body, API)) });
}));
project.post('/posts', wrap(async (req, res) => {
  res.status(201).json({ ok: true, ...(await svc.createPost(req.project, req.body, API)) });
}));
project.get('/posts', wrap(async (req, res) => res.json({ ok: true, ...(await svc.listPosts(req.project, req.query)) })));
project.get('/posts/:id', wrap(async (req, res) => res.json({ ok: true, post: await svc.getPost(req.project, req.params.id) })));
project.post('/posts/:id/targets/:platform/retry', wrap(async (req, res) => {
  await svc.retryTarget(req.project, req.params.id, req.params.platform);
  res.json({ ok: true });
}));
project.delete('/posts/:id', wrap(async (req, res) => {
  res.json({ ok: true, ...(await svc.deletePost(req.project, req.params.id, { remote: req.query.remote === 'true' })) });
}));

module.exports = v1;
