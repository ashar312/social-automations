'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { fn, col } = require('sequelize');
const { Project, PlatformAccount, Post } = require('../db/models');
const loadProject = require('../middleware/loadProject');
const { publicView } = require('../services/accounts');
const apiKeys = require('../services/apiKeys');

router.param('projectId', loadProject);

const create = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must look like #7c5cff').optional(),
  icon: z.string().max(32).nullish(),
  description: z.string().max(500).nullish(),
  settings: z.object({
    captionFooter: z.string().max(500).optional(),
    hashtags: z.string().max(300).optional(),
  }).nullish(),
});
const patch = create.partial().extend({ archived: z.boolean().optional() });

function parse(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) throw Object.assign(new Error(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')), { status: 400 });
  return r.data;
}
const dupe = (e) => (e.name === 'SequelizeUniqueConstraintError' ? Object.assign(new Error('A project with that name already exists'), { status: 409 }) : e);

const WORST = { expired: 3, error: 2, connected: 1 };
function view(p, accounts = [], postCount = 0) {
  const shown = accounts.map((a) => publicView(a));
  const worst = shown.reduce((w, a) => ((WORST[a.status] || 0) > (WORST[w] || 0) ? a.status : w), 'none');
  return {
    id: p.id, publicId: p.public_id, name: p.name, color: p.color, icon: p.icon, description: p.description, settings: p.settings || {},
    archived: !!p.archived_at, createdAt: p.created_at,
    apiKey: p.api_key_hash ? { hint: p.api_key_hint, createdAt: p.api_key_created_at, lastUsedAt: p.api_key_last_used_at } : null,
    connected: shown.map((a) => a.platform), connectedCount: shown.length, postCount, worstStatus: worst,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const where = req.query.archived === 'true' ? {} : { archived_at: null };
    const projects = await Project.findAll({ where, order: [['name', 'ASC']] });
    const ids = projects.map((p) => p.id);
    const accounts = await PlatformAccount.findAll({ where: { project_id: ids } });
    const counts = await Post.findAll({ attributes: ['project_id', [fn('COUNT', col('id')), 'n']], where: { project_id: ids }, group: ['project_id'], raw: true });
    const n = new Map(counts.map((c) => [c.project_id, Number(c.n)]));
    res.json({ ok: true, projects: projects.map((p) => view(p, accounts.filter((a) => a.project_id === p.id), n.get(p.id) || 0)) });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const d = parse(create, req.body);
    const p = await Project.create({ name: d.name, color: d.color, icon: d.icon || null, description: d.description || null, settings: d.settings || null });
    res.status(201).json({ ok: true, project: view(p) });
  } catch (e) { next(dupe(e)); }
});

router.patch('/:projectId', async (req, res, next) => {
  try {
    const d = parse(patch, req.body);
    const { archived, ...rest } = d;
    if (archived !== undefined) rest.archived_at = archived ? new Date() : null;
    await req.project.update(rest);
    res.json({ ok: true, project: view(req.project) });
  } catch (e) { next(dupe(e)); }
});

router.delete('/:projectId', async (req, res, next) => {
  try {
    const posts = await Post.count({ where: { project_id: req.project.id } });
    if (posts) return res.status(409).json({ ok: false, error: `This project has ${posts} post(s). Archive it instead.` });
    await req.project.destroy(); // cascades its connections
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// API key for the external API (/api/v1). The plain key is returned only here, once.
router.post('/:projectId/api-key', async (req, res, next) => {
  try {
    const { key, fields } = apiKeys.generate();
    await req.project.update(fields);
    res.status(201).json({ ok: true, key, projectId: req.project.public_id, project: view(req.project) });
  } catch (e) { next(e); }
});
router.delete('/:projectId/api-key', async (req, res, next) => {
  try {
    await req.project.update({ api_key_hash: null, api_key_hint: null, api_key_created_at: null, api_key_last_used_at: null });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.use('/:projectId/connections', require('./connections').scoped);
router.use('/:projectId/posts', require('./posts').scoped);

module.exports = router;
