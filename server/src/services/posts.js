'use strict';
/**
 * Post logic shared by the UI routes (/api/...), the external API (/api/v1) and the MCP server.
 * Functions take a project (or null for the UI's global routes) plus plain input, and return data
 * or throw an Error with { status, results? } that routes turn into JSON and MCP into tool errors.
 */
const crypto = require('crypto');
const { z } = require('zod');
const env = require('../config/env');
const { sequelize, Post, PostTarget, MediaFile, ActivityLog, PlatformAccount, Project } = require('../db/models');
const { evaluate } = require('../platforms/rules');
const mediaSvc = require('./media');

const PLATFORMS = ['linkedin', 'youtube', 'facebook', 'instagram'];
const POST_STATUSES = ['queued', 'publishing', 'completed', 'partial', 'failed'];
const FINAL_STATUSES = ['completed', 'partial', 'failed'];

const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...extra });

// The descriptions are shown to AI clients (MCP tool schemas); REST validation is unaffected.
const targetSchema = z.object({
  platform: z.enum(PLATFORMS),
  overrides: z.record(z.string(), z.any()).nullish().describe(
    'Optional per-platform changes. caption (all): replaces the caption on this platform. youtube: title, privacy '
    + '("public" | "unlisted" | "private"; forced private until the YouTube API audit passes), tags (array), categoryId (default "22"). '
    + 'instagram: shareToFeed (false = Reel only in the Reels tab). linkedin: title (carousel header for document posts).',
  ),
});
const bodySchema = z.object({
  contentType: z.enum(['text', 'image', 'video', 'reel', 'document']).describe(
    'reel = vertical short video (Instagram/Facebook Reels, YouTube Shorts). '
    + 'document = PDF carousel (LinkedIn only; exactly one PDF media id; needs a title)',
  ),
  caption: z.string().default('').describe("Post text / video description. The project's caption footer and hashtags are appended automatically"),
  title: z.string().nullish().describe('Video title (YouTube) or carousel title (LinkedIn PDF). Required for both'),
  mediaIds: z.array(z.number().int()).default([]).describe('Ids from an upload_media_* call, in display order. Each id can be used in one post only'),
  targets: z.array(targetSchema).min(1, 'Pick at least one platform').describe('Platforms to post to'),
  alsoProjects: z.array(z.number().int()).default([]),
  publishNow: z.boolean().default(true).describe('false = schedule for scheduledAt'),
  scheduledAt: z.string().datetime({ offset: true }).nullish().describe('ISO 8601 with a UTC offset, e.g. "2026-11-25T09:00:00+05:00". Used when publishNow is false'),
});

async function loadMedia(ids, userId) {
  if (!ids.length) return [];
  const rows = await MediaFile.findAll({ where: { id: ids } });
  // media of another user is reported as unknown, same as a missing id
  const byId = new Map(rows.filter((r) => r.user_id === userId).map((r) => [r.id, r]));
  const missing = ids.filter((i) => !byId.has(i));
  if (missing.length) throw fail(400, `Unknown media id(s): ${missing.join(', ')}`);
  return ids.map((i) => byId.get(i));
}

/** Parse + evaluate against one project's accounts. Returns { body, media, results, accountIds: {platform: id} } */
async function check(raw, projectId) {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw fail(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const body = parsed.data;
  const project = await Project.findByPk(projectId);
  const st = (project && project.settings) || {};
  const suffix = [st.captionFooter, st.hashtags].map((x) => (x || '').trim()).filter(Boolean).join('\n\n');
  if (suffix) {
    const add = (c) => (c && c.trim() ? `${c}\n\n${suffix}` : c);
    body.caption = add(body.caption);
    for (const t of body.targets) if (t.overrides && typeof t.overrides.caption === 'string') t.overrides = { ...t.overrides, caption: add(t.overrides.caption) };
  }
  const media = await loadMedia(body.mediaIds, project && project.user_id);
  const accounts = await PlatformAccount.findAll({ where: { project_id: projectId } });
  const live = accounts.filter((a) => a.status !== 'expired');
  const connected = new Set(live.map((a) => a.platform));
  const accountIds = Object.fromEntries(live.map((a) => [a.platform, a.id]));
  const results = {};
  for (const t of body.targets) {
    const ev = evaluate(t.platform, { contentType: body.contentType, caption: body.caption, title: body.title, overrides: t.overrides }, media, {
      youtubeAudited: env.YOUTUBE_AUDITED, publicBaseUrl: env.PUBLIC_BASE_URL,
    });
    if (ev.supported && !connected.has(t.platform)) ev.errors.push(`${t.platform} is not connected`);
    results[t.platform] = ev;
  }
  return { body, media, results, accountIds };
}

/** posts.status roll-up rule from 01-database.md */
function rollup(targets) {
  const active = targets.filter((t) => t.status !== 'skipped');
  if (!active.length) return 'completed';
  if (active.some((t) => ['pending', 'uploading', 'processing'].includes(t.status))) return 'publishing';
  const pub = active.filter((t) => t.status === 'published').length;
  if (pub === active.length) return 'completed';
  if (pub === 0) return 'failed';
  return 'partial';
}

/**
 * External API / MCP input rules: no cross-posting, and every media id must be an unattached upload
 * made through this same project (so a key can't attach another project's uploads by guessing ids).
 */
async function apiInput(project, raw) {
  const body = { ...(raw || {}) };
  if (Array.isArray(body.alsoProjects) && body.alsoProjects.length) {
    throw fail(400, 'alsoProjects is not available in the API. Call each project with its own key.');
  }
  delete body.alsoProjects;
  const ids = Array.isArray(body.mediaIds) ? body.mediaIds.filter(Number.isInteger) : [];
  if (ids.length) {
    const rows = await MediaFile.findAll({ where: { id: ids }, attributes: ['id', 'post_id', 'project_id'] });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const foreign = ids.filter((i) => !byId.has(i) || byId.get(i).project_id !== project.id);
    if (foreign.length) throw fail(400, `Unknown media id(s): ${foreign.join(', ')}. Upload the media through this project first.`);
    const used = rows.filter((m) => m.post_id != null);
    if (used.length) throw fail(400, `Media already used by another post: ${used.map((m) => m.id).join(', ')}. Upload it again.`);
  }
  return body;
}

/** Dry run: per-platform { supported, errors, warnings, ... }. */
async function validatePost(project, raw, { api = false } = {}) {
  const input = api ? await apiInput(project, raw) : raw;
  const { results } = await check(input, project.id);
  return { results };
}

/**
 * Inserts a post (+ targets) in one project from an evaluated check().
 * `copyMedia` clones the media rows (same files on disk) instead of moving them, for cross-posts.
 */
async function insertPost(projectId, { body, media, results, accountIds }, { copyMedia = false, via = null } = {}) {
  const scheduled = !body.publishNow && body.scheduledAt ? new Date(body.scheduledAt) : null;
  const post = await sequelize.transaction(async (t) => {
    const p = await Post.create({
      project_id: projectId, content_type: body.contentType, caption: body.caption, title: body.title || null,
      status: 'queued', scheduled_at: scheduled, created_via: via,
    }, { transaction: t });
    for (let i = 0; i < media.length; i++) {
      if (!copyMedia) { await media[i].update({ post_id: p.id, position: i, project_id: projectId }, { transaction: t }); continue; }
      const { id, created_at: _c, ...row } = media[i].get({ plain: true });
      await MediaFile.create({ ...row, project_id: projectId, post_id: p.id, position: i, public_token: crypto.randomBytes(16).toString('hex') }, { transaction: t });
    }
    for (const tg of body.targets) {
      const r = results[tg.platform];
      await PostTarget.create({
        post_id: p.id, platform: tg.platform, platform_account_id: r.supported ? accountIds[tg.platform] || null : null, overrides: tg.overrides || null,
        status: r.supported ? 'pending' : 'skipped', error_message: r.supported ? null : r.reason,
        finished_at: r.supported ? null : new Date(),
      }, { transaction: t });
    }
    return p;
  });
  const targets = await PostTarget.findAll({ where: { post_id: post.id } });
  await post.update({ status: rollup(targets) === 'publishing' ? 'queued' : rollup(targets) });
  return post;
}

/**
 * Validates and queues a post (the worker publishes it). UI mode may cross-post to `alsoProjects`;
 * API mode (`api: true`) applies apiInput(). `via` records where it came from ("api", "mcp:Claude Code").
 * Returns { id, status, also }.
 */
async function createPost(project, raw, { api = false, via = null } = {}) {
  const input = api ? await apiInput(project, raw) : raw;
  const first = await check(input, project.id);
  const { body, results } = first;
  if (Object.values(results).some((r) => r.supported && r.errors.length)) {
    throw fail(400, 'Fix the validation errors first', { results });
  }
  if (!Object.values(results).some((r) => r.supported)) {
    throw fail(400, 'None of the selected platforms support this content', { results });
  }
  const post = await insertPost(project.id, first, { via });
  // Cross-post: one separate post per extra project. Best effort; failures are reported, not fatal.
  const also = [];
  for (const pid of [...new Set(body.alsoProjects)].filter((x) => x !== project.id)) {
    const proj = await Project.findOne({ where: { id: pid, user_id: project.user_id } });
    try {
      if (!proj || proj.archived_at) throw new Error('Project not found or archived');
      const c = await check(input, pid);
      // only platforms that are connected and valid in that project
      c.body.targets = c.body.targets.filter((tg) => c.results[tg.platform].supported && !c.results[tg.platform].errors.length);
      if (!c.body.targets.length) {
        const why = Object.values(c.results).flatMap((r) => r.errors)[0] || 'no selected platform is connected there';
        throw new Error(why);
      }
      const p2 = await insertPost(pid, c, { copyMedia: true, via });
      also.push({ projectId: pid, projectName: proj.name, ok: true, id: p2.id });
    } catch (e) { also.push({ projectId: pid, projectName: proj ? proj.name : String(pid), ok: false, error: e.message }); }
  }
  return { id: post.id, status: post.status, also };
}

const targetView = (t) => ({
  id: t.id, platform: t.platform, status: t.status, progress: t.progress, attempts: t.attempts,
  externalUrl: t.external_url, errorMessage: t.error_message, nextAttemptAt: t.next_attempt_at,
  startedAt: t.started_at, finishedAt: t.finished_at,
});

function listView(p) {
  const media = (p.media || []).slice().sort((a, b) => a.position - b.position);
  return {
    id: p.id, projectId: p.project_id, contentType: p.content_type, caption: p.caption, title: p.title, status: p.status,
    scheduledAt: p.scheduled_at, createdAt: p.createdAt, createdVia: p.created_via || null,
    thumbnailMediaId: media[0] ? media[0].id : null,
    pageCount: media[0] && media[0].kind === 'document' ? media[0].page_count : null,
    targets: (p.targets || []).map(targetView),
  };
}

/** One project's posts, or every project's when `project` is null. Returns { page, total, posts }. */
async function listPosts(project, query = {}, { userId = null } = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
  const where = project ? { project_id: project.id } : {};
  if (!project) {
    const mine = await Project.findAll({ where: { user_id: userId }, attributes: ['id'] });
    where.project_id = mine.map((p) => p.id);
  }
  if (query.status) where.status = query.status;
  const include = [{ model: PostTarget, as: 'targets', required: !!query.platform, where: query.platform ? { platform: query.platform } : undefined },
    { model: MediaFile, as: 'media', required: false }];
  const { rows, count } = await Post.findAndCountAll({
    where, include, distinct: true, order: [['id', 'DESC']], limit, offset: (page - 1) * limit,
  });
  // re-load all targets when filtering by platform (the include above was restricted)
  let full = rows;
  if (query.platform) {
    const ids = rows.map((r) => r.id);
    full = await Post.findAll({ where: { id: ids }, include: ['targets', { model: MediaFile, as: 'media' }], order: [['id', 'DESC']] });
  }
  return { page, total: count, posts: full.map(listView) };
}

/** Loads a post; with a project, it must belong to it (404 otherwise). */
async function findPost(project, id, include, userId = null) {
  const n = Number(id);
  const p = Number.isInteger(n) && n > 0 ? await Post.findByPk(n, include ? { include } : undefined) : null;
  if (!p || (project && p.project_id !== project.id)) throw fail(404, project ? 'Post not found in this project' : 'Not found');
  if (!project) {
    // global UI routes: the post's project must belong to the signed-in user
    const owner = await Project.count({ where: { id: p.project_id, user_id: userId } });
    if (!owner) throw fail(404, 'Not found');
  }
  return p;
}

/** Full post with media, targets and (newest `logLimit`, oldest first) log lines. */
async function getPost(project, id, { logLimit = 300, userId = null } = {}) {
  const p = await findPost(project, id, ['targets', { model: MediaFile, as: 'media' }], userId);
  const ids = p.targets.map((t) => t.id);
  const logs = ids.length && logLimit > 0 ? await ActivityLog.findAll({ where: { post_target_id: ids }, order: [['id', 'DESC']], limit: logLimit }) : [];
  return {
    ...listView(p),
    media: p.media.sort((a, b) => a.position - b.position).map(mediaSvc.view),
    targets: p.targets.map((t) => ({ ...targetView(t), overrides: t.overrides, errorRaw: t.error_raw })),
    logs: logs.reverse().map((l) => ({ id: Number(l.id), targetId: l.post_target_id, level: l.level, message: l.message, data: l.data, createdAt: l.createdAt })),
  };
}

/** Puts a failed/pending platform target back in the queue. */
async function retryTarget(project, id, platform, userId = null) {
  const p = await findPost(project, id, undefined, userId);
  const t = await PostTarget.findOne({ where: { post_id: p.id, platform } });
  if (!t) throw fail(404, `This post has no ${platform} target`);
  if (t.status === 'published') throw fail(400, 'Already published');
  await t.update({ status: 'pending', attempts: 0, progress: 0, next_attempt_at: null, locked_at: null, error_message: null, error_raw: null, finished_at: null });
  await Post.update({ status: 'publishing' }, { where: { id: p.id } });
  return { id: p.id, platform };
}

/** Deletes a post (and its media files); `remote` also deletes it on the platforms that allow it. Returns { remote: [...] }. */
async function deletePost(project, id, { remote = false, userId = null } = {}) {
  const adapters = require('../platforms');
  const { ensureFresh } = require('./tokens');
  const p = await findPost(project, id, ['targets', { model: MediaFile, as: 'media' }], userId);
  const out = [];
  if (remote) {
    for (const t of p.targets.filter((x) => x.status === 'published' && x.external_id)) {
      const a = adapters[t.platform];
      const acc = (t.platform_account_id && await PlatformAccount.findByPk(t.platform_account_id))
        || await PlatformAccount.findOne({ where: { project_id: p.project_id, platform: t.platform } });
      if (!a.remove || !acc) { out.push({ platform: t.platform, ok: false, error: 'Not supported by the API' }); continue; }
      try { await a.remove({ target: t, account: await ensureFresh(acc) }); out.push({ platform: t.platform, ok: true }); }
      catch (e) { out.push({ platform: t.platform, ok: false, error: e.message }); }
    }
  }
  for (const m of p.media) await mediaSvc.removeUnlessShared(m, [p.id]).catch(() => {});
  await p.destroy();
  return { remote: out };
}

module.exports = {
  check, rollup, PLATFORMS, POST_STATUSES, FINAL_STATUSES, bodySchema, targetSchema,
  validatePost, createPost, listPosts, getPost, retryTarget, deletePost, listView, targetView,
};
