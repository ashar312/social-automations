'use strict';
const { z } = require('zod');
const env = require('../../config/env');
const svc = require('../../services/posts');
const guard = require('../guard');
const format = require('../format');

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const SCHEDULE_LEAD_MIN = 10;
const WAIT_MAX_SEC = 120;
const POLL_MS = 3000;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const postInput = svc.bodySchema.omit({ alsoProjects: true });
const postId = z.number().int().positive().describe('Post id');
const postOut = z.looseObject({ id: z.number(), status: z.string(), targets: z.array(z.looseObject({ platform: z.string(), status: z.string() })) });

/** Smaller post for MCP responses: last 20 log lines, no raw platform errors. */
async function compactPost(project, id) {
  const p = await svc.getPost(project, id, { logLimit: 20 });
  return { ...p, targets: p.targets.map(({ errorRaw, ...t }) => t) };
}

const isScheduledLater = (p) => p.status === 'queued' && p.scheduledAt && new Date(p.scheduledAt) > new Date();
const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

module.exports = function register(define, ctx) {
  const { project } = ctx;

  define('validate_post', {
    title: 'Validate post (dry run)',
    description: 'Checks a post against each platform\'s rules and this project\'s connections without publishing. '
      + 'Same input as create_post. Platforms that can\'t take the content type are reported as skipped. Always call this before create_post.',
    inputSchema: postInput,
    annotations: READ,
    outputSchema: z.looseObject({ results: z.record(z.string(), z.looseObject({ supported: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.string()) })) }),
  }, async (args) => {
    const r = await svc.validatePost(project, args, { api: true });
    return { text: format.validation(r.results), data: r };
  });

  define('create_post', {
    title: 'Create post (publishes publicly)',
    description: 'Publishes (or schedules) a post to the chosen platforms of this project. This is PUBLIC and visible to followers. '
      + 'Before calling: run validate_post, then show the user the final caption(s), platforms and time and get their explicit OK. '
      + 'Returns immediately with the post id; publishing happens in the background, so call wait_for_post to get the live URLs.',
    inputSchema: postInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    outputSchema: z.looseObject({ id: z.number(), status: z.string() }),
  }, async (args) => {
    const st = project.settings || {};
    if (st.mcpPublishNow === false) {
      const at = args.scheduledAt ? new Date(args.scheduledAt) : null;
      if (args.publishNow !== false || !at || at.getTime() < Date.now() + SCHEDULE_LEAD_MIN * 60_000) {
        throw bad(`This project only lets AI clients schedule posts: set publishNow: false and scheduledAt at least ${SCHEDULE_LEAD_MIN} minutes from now, so a person can review it in History first.`);
      }
    }
    if (!guard.posts.allow(project.id)) throw bad(`Post limit reached (${env.MCP_POSTS_PER_HOUR} posts per hour through MCP for this project). Try again later.`);
    const r = await svc.createPost(project, args, { api: true, via: `mcp:${ctx.client}` });
    const data = { id: r.id, status: r.status };
    const when = args.publishNow === false && args.scheduledAt ? `scheduled for ${args.scheduledAt}` : 'queued for publishing now';
    return { text: `Post #${r.id} created (${r.status}), ${when}. Call wait_for_post with id ${r.id} to follow it and get the live links.`, data, postId: r.id };
  });

  define('list_posts', {
    title: 'List posts',
    description: 'Recent posts of this project, newest first, with per-platform status.',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
      status: z.enum(svc.POST_STATUSES).optional().describe('Filter by overall status'),
      platform: z.enum(svc.PLATFORMS).optional().describe('Only posts that target this platform'),
    },
    annotations: READ,
    outputSchema: z.looseObject({ page: z.number(), total: z.number(), posts: z.array(z.looseObject({ id: z.number() })) }),
  }, async (args) => {
    const r = await svc.listPosts(project, args);
    return { text: format.postList(r), data: r };
  });

  define('get_post', {
    title: 'Get post',
    description: 'One post: status per platform, live URLs once published, error messages, and the last log lines.',
    inputSchema: { id: postId },
    annotations: READ,
    outputSchema: postOut,
  }, async ({ id }) => {
    const p = await compactPost(project, id);
    return { text: format.post(p), data: p, postId: p.id };
  });

  define('wait_for_post', {
    title: 'Wait for post',
    description: `Waits until a post has finished publishing on every platform (or timeoutSec passes, max ${WAIT_MAX_SEC}), sending progress updates, `
      + 'then returns its status and live URLs. If it is still running, call it again. Returns at once for posts scheduled in the future.',
    inputSchema: {
      id: postId,
      timeoutSec: z.number().int().min(1).max(WAIT_MAX_SEC).optional().describe('Default 60'),
    },
    annotations: READ,
    outputSchema: postOut.extend({ done: z.boolean() }),
  }, async ({ id, timeoutSec = 60 }, extra) => {
    const deadline = Date.now() + timeoutSec * 1000;
    const token = extra && extra._meta && extra._meta.progressToken;
    let p;
    for (;;) {
      p = await svc.getPost(project, id, { logLimit: 0 });
      const done = svc.FINAL_STATUSES.includes(p.status);
      if (done || isScheduledLater(p) || Date.now() >= deadline || (extra && extra.signal.aborted)) break;
      if (token !== undefined) {
        const active = p.targets.filter((t) => t.status !== 'skipped');
        const finished = (t) => ['published', 'failed'].includes(t.status);
        const pct = active.length ? Math.round(active.reduce((s, t) => s + (finished(t) ? 100 : Number(t.progress) || 0), 0) / active.length) : 100;
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken: token, progress: pct, total: 100, message: active.map((t) => `${t.platform}: ${t.status}`).join(', ') },
        }).catch(() => {});
      }
      await sleep(POLL_MS, extra && extra.signal);
    }
    const full = await compactPost(project, id);
    const done = svc.FINAL_STATUSES.includes(full.status);
    let note = '';
    if (isScheduledLater(full)) note = '\nScheduled for later: nothing to wait for yet.';
    else if (!done) note = '\nStill publishing. Call wait_for_post again to keep waiting.';
    return { text: format.post(full) + note, data: { ...full, done }, postId: full.id };
  });

  define('retry_post_target', {
    title: 'Retry a platform',
    description: 'Puts one failed platform of a post back in the publishing queue. Check the error first (get_post): '
      + 'errors like "reconnect" or validation problems need the user to fix something in the app, retrying won\'t help.',
    inputSchema: { id: postId, platform: z.enum(svc.PLATFORMS) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    outputSchema: z.looseObject({ id: z.number(), platform: z.string() }),
  }, async ({ id, platform }) => {
    const r = await svc.retryTarget(project, id, platform);
    return { text: `${platform} of post #${id} is queued again. Use wait_for_post to follow it.`, data: r, postId: id };
  });

  define('delete_post', {
    title: 'Delete post',
    description: 'Deletes a post and its media from this app. With remote: true it is ALSO deleted on the platforms that allow it '
      + '(this cannot be undone). Always confirm with the user first.',
    inputSchema: {
      id: postId,
      remote: z.boolean().optional().describe('Also delete the published post on the platforms (default false)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    outputSchema: z.looseObject({ id: z.number(), remote: z.array(z.looseObject({ platform: z.string(), ok: z.boolean() })) }),
  }, async ({ id, remote = false }) => {
    const r = await svc.deletePost(project, id, { remote });
    const lines = r.remote.map((x) => `- ${x.platform}: ${x.ok ? 'deleted on the platform' : `not deleted there (${x.error})`}`);
    return { text: `Post #${id} deleted from the app.${lines.length ? `\n${lines.join('\n')}` : ''}`, data: { id, ...r }, postId: id };
  });
};
