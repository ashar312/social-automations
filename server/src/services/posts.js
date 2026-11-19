'use strict';
const { z } = require('zod');
const env = require('../config/env');
const { MediaFile, PlatformAccount, Project } = require('../db/models');
const { evaluate } = require('../platforms/rules');

const PLATFORMS = ['linkedin', 'youtube', 'facebook', 'instagram'];

const bodySchema = z.object({
  contentType: z.enum(['text', 'image', 'video', 'reel']),
  caption: z.string().default(''),
  title: z.string().nullish(),
  mediaIds: z.array(z.number().int()).default([]),
  targets: z.array(z.object({
    platform: z.enum(PLATFORMS),
    overrides: z.record(z.string(), z.any()).nullish(),
  })).min(1, 'Pick at least one platform'),
  alsoProjects: z.array(z.number().int()).default([]),
  publishNow: z.boolean().default(true),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
});

async function loadMedia(ids) {
  if (!ids.length) return [];
  const rows = await MediaFile.findAll({ where: { id: ids } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((i) => !byId.has(i));
  if (missing.length) throw Object.assign(new Error(`Unknown media id(s): ${missing.join(', ')}`), { status: 400 });
  return ids.map((i) => byId.get(i));
}

/** Parse + evaluate against one project's accounts. Returns { body, media, results, accountIds: {platform: id} } */
async function check(raw, projectId) {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')), { status: 400 });
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
  const media = await loadMedia(body.mediaIds);
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

module.exports = { check, rollup, PLATFORMS };
