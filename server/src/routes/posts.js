'use strict';
/** UI post routes. The logic lives in services/posts.js (shared with the external API and MCP). */
const express = require('express');
const router = express.Router(); // global: /api/posts/:id...
const scoped = express.Router({ mergeParams: true }); // /api/projects/:projectId/posts
const svc = require('../services/posts');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) { next(e); }
};

scoped.post('/validate', wrap(async (req, res) => {
  res.json({ ok: true, ...(await svc.validatePost(req.project, req.body)) });
}));

scoped.post('/', wrap(async (req, res) => {
  res.status(201).json({ ok: true, ...(await svc.createPost(req.project, req.body)) });
}));

// Lists one project's posts (scoped) or every project's (GET /api/posts).
const list = wrap(async (req, res) => res.json({ ok: true, ...(await svc.listPosts(req.project || null, req.query)) }));
scoped.get('/', list);
router.get('/', list);

router.get('/:id', wrap(async (req, res) => res.json({ ok: true, post: await svc.getPost(null, req.params.id) })));

router.post('/:id/targets/:platform/retry', wrap(async (req, res) => {
  await svc.retryTarget(null, req.params.id, req.params.platform);
  res.json({ ok: true });
}));

router.delete('/:id', wrap(async (req, res) => {
  res.json({ ok: true, ...(await svc.deletePost(null, req.params.id, { remote: req.query.remote === 'true' })) });
}));

module.exports = router;
module.exports.scoped = scoped;
