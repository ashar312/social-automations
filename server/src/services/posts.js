'use strict';
const { z } = require('zod');
const env = require('../config/env');
const { MediaFile, PlatformAccount } = require('../db/models');
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

/** Parse + evaluate. Returns { body, media, results: {platform: evaluation}, connected } */
async function check(raw) {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')), { status: 400 });
  }
  const body = parsed.data;
  const media = await loadMedia(body.mediaIds);
  const accounts = await PlatformAccount.findAll();
  const connected = new Set(accounts.filter((a) => a.status !== 'expired').map((a) => a.platform));
  const results = {};
  for (const t of body.targets) {
    const ev = evaluate(t.platform, { contentType: body.contentType, caption: body.caption, title: body.title, overrides: t.overrides }, media, {
      youtubeAudited: env.YOUTUBE_AUDITED, publicBaseUrl: env.PUBLIC_BASE_URL,
    });
    if (ev.supported && !connected.has(t.platform)) ev.errors.push(`${t.platform} is not connected`);
    results[t.platform] = ev;
  }
  return { body, media, results };
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
