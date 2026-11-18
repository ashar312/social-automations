'use strict';
const router = require('express').Router();
const { Op } = require('sequelize');
const { sequelize, Post, PostTarget, MediaFile, ActivityLog, PlatformAccount } = require('../db/models');
const { check, rollup } = require('../services/posts');
const { view } = require('./media');
const mediaSvc = require('../services/media');
const adapters = require('../platforms');
const { ensureFresh } = require('../services/tokens');

router.post('/validate', async (req, res, next) => {
  try {
    const { results } = await check(req.body);
    res.json({ ok: true, results });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { body, media, results } = await check(req.body);
    const blocking = Object.entries(results).filter(([, r]) => r.supported && r.errors.length);
    if (blocking.length) {
      return res.status(400).json({ ok: false, error: 'Fix the validation errors first', results });
    }
    if (!Object.values(results).some((r) => r.supported)) {
      return res.status(400).json({ ok: false, error: 'None of the selected platforms support this content', results });
    }
    const scheduled = !body.publishNow && body.scheduledAt ? new Date(body.scheduledAt) : null;
    const post = await sequelize.transaction(async (t) => {
      const p = await Post.create({
        content_type: body.contentType, caption: body.caption, title: body.title || null,
        status: 'queued', scheduled_at: scheduled,
      }, { transaction: t });
      for (let i = 0; i < media.length; i++) await media[i].update({ post_id: p.id, position: i }, { transaction: t });
      for (const tg of body.targets) {
        const r = results[tg.platform];
        await PostTarget.create({
          post_id: p.id, platform: tg.platform, overrides: tg.overrides || null,
          status: r.supported ? 'pending' : 'skipped', error_message: r.supported ? null : r.reason,
          finished_at: r.supported ? null : new Date(),
        }, { transaction: t });
      }
      return p;
    });
    const targets = await PostTarget.findAll({ where: { post_id: post.id } });
    await post.update({ status: rollup(targets) === 'publishing' ? 'queued' : rollup(targets) });
    res.status(201).json({ ok: true, id: post.id });
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const include = [{ model: PostTarget, as: 'targets', required: !!req.query.platform, where: req.query.platform ? { platform: req.query.platform } : undefined },
      { model: MediaFile, as: 'media', required: false }];
    const { rows, count } = await Post.findAndCountAll({
      where, include, distinct: true, order: [['id', 'DESC']], limit, offset: (page - 1) * limit,
    });
    // re-load all targets when filtering by platform (the include above was restricted)
    let full = rows;
    if (req.query.platform) {
      const ids = rows.map((r) => r.id);
      full = await Post.findAll({ where: { id: ids }, include: ['targets', { model: MediaFile, as: 'media' }], order: [['id', 'DESC']] });
    }
    res.json({ ok: true, page, total: count, posts: full.map(listView) });
  } catch (e) { next(e); }
});

function listView(p) {
  const media = (p.media || []).slice().sort((a, b) => a.position - b.position);
  return {
    id: p.id, contentType: p.content_type, caption: p.caption, title: p.title, status: p.status,
    scheduledAt: p.scheduled_at, createdAt: p.created_at,
    thumbnailMediaId: media[0] ? media[0].id : null,
    targets: (p.targets || []).map(targetView),
  };
}
const targetView = (t) => ({
  id: t.id, platform: t.platform, status: t.status, progress: t.progress, attempts: t.attempts,
  externalUrl: t.external_url, errorMessage: t.error_message, nextAttemptAt: t.next_attempt_at,
  startedAt: t.started_at, finishedAt: t.finished_at,
});

router.get('/:id', async (req, res, next) => {
  try {
    const p = await Post.findByPk(req.params.id, { include: ['targets', { model: MediaFile, as: 'media' }] });
    if (!p) return res.status(404).json({ ok: false, error: 'Not found' });
    const ids = p.targets.map((t) => t.id);
    const logs = ids.length ? await ActivityLog.findAll({ where: { post_target_id: ids }, order: [['id', 'DESC']], limit: 300 }) : [];
    res.json({
      ok: true,
      post: {
        ...listView(p),
        media: p.media.sort((a, b) => a.position - b.position).map(view),
        targets: p.targets.map((t) => ({ ...targetView(t), overrides: t.overrides, errorRaw: t.error_raw })),
        logs: logs.reverse().map((l) => ({ id: Number(l.id), targetId: l.post_target_id, level: l.level, message: l.message, data: l.data, createdAt: l.created_at })),
      },
    });
  } catch (e) { next(e); }
});

router.post('/:id/targets/:platform/retry', async (req, res, next) => {
  try {
    const t = await PostTarget.findOne({ where: { post_id: req.params.id, platform: req.params.platform } });
    if (!t) return res.status(404).json({ ok: false, error: 'Not found' });
    if (t.status === 'published') return res.status(400).json({ ok: false, error: 'Already published' });
    await t.update({ status: 'pending', attempts: 0, progress: 0, next_attempt_at: null, locked_at: null, error_message: null, error_raw: null, finished_at: null });
    await Post.update({ status: 'publishing' }, { where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const p = await Post.findByPk(req.params.id, { include: ['targets', { model: MediaFile, as: 'media' }] });
    if (!p) return res.status(404).json({ ok: false, error: 'Not found' });
    const remote = [];
    if (req.query.remote === 'true') {
      for (const t of p.targets.filter((x) => x.status === 'published' && x.external_id)) {
        const a = adapters[t.platform];
        const acc = await PlatformAccount.findOne({ where: { platform: t.platform } });
        if (!a.remove || !acc) { remote.push({ platform: t.platform, ok: false, error: 'Not supported by the API' }); continue; }
        try { await a.remove({ target: t, account: await ensureFresh(acc) }); remote.push({ platform: t.platform, ok: true }); }
        catch (e) { remote.push({ platform: t.platform, ok: false, error: e.message }); }
      }
    }
    for (const m of p.media) await mediaSvc.removeFiles(m.stored_path).catch(() => {});
    await p.destroy();
    res.json({ ok: true, remote });
  } catch (e) { next(e); }
});

module.exports = router;
