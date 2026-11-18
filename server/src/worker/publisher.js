'use strict';
const { Op } = require('sequelize');
const env = require('../config/env');
const { Post, PostTarget, MediaFile, ActivityLog, PlatformAccount } = require('../db/models');
const adapters = require('../platforms');
const { ensureFresh, testAccount } = require('../services/tokens');
const { rollup } = require('../services/posts');
const { PublishError, fromHttp } = require('../services/errors');
const media = require('../services/media');

const TICK_MS = 5000;
const MAX_CONCURRENT = 2;
const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [1, 5, 15];
let running = 0;
let timer = null;

async function log(targetId, level, message, data) {
  try { await ActivityLog.create({ post_target_id: targetId, level, message: String(message).slice(0, 1000), data: data || null }); }
  catch (e) { console.error('log failed', e.message); }
}

async function updatePostStatus(postId) {
  const targets = await PostTarget.findAll({ where: { post_id: postId } });
  await Post.update({ status: rollup(targets) }, { where: { id: postId } });
}

async function recover() {
  const stale = new Date(Date.now() - 30 * 60 * 1000);
  await PostTarget.update({ locked_at: null }, { where: { locked_at: { [Op.lt]: stale }, status: 'pending' } });
  const [n] = await PostTarget.update(
    { status: 'pending', locked_at: null, progress: 0 },
    { where: { status: { [Op.in]: ['uploading', 'processing'] } } },
  );
  if (n) console.log(`Worker: reset ${n} interrupted job(s) to pending`);
}

async function claim(slots) {
  const now = new Date();
  const candidates = await PostTarget.findAll({
    where: { status: 'pending', locked_at: null, [Op.or]: [{ next_attempt_at: null }, { next_attempt_at: { [Op.lte]: now } }] },
    include: [{ model: Post, as: 'post', required: true, where: { [Op.or]: [{ scheduled_at: null }, { scheduled_at: { [Op.lte]: now } }] } }],
    order: [['id', 'ASC']], limit: slots,
  });
  const claimed = [];
  for (const c of candidates) {
    const [n] = await PostTarget.update({ locked_at: new Date() }, { where: { id: c.id, locked_at: null, status: 'pending' } });
    if (n) claimed.push(c);
  }
  return claimed;
}

async function runTarget(t) {
  const post = t.post;
  const mediaRows = (await MediaFile.findAll({ where: { post_id: post.id }, order: [['position', 'ASC']] }));
  let lastProgress = -1;
  const ctx = {
    post, target: t, media: mediaRows, account: null,
    log: (level, msg, data) => log(t.id, level, msg, data),
    setProgress: (p) => {
      p = Math.max(0, Math.min(100, Math.round(p)));
      if (p === lastProgress) return;
      lastProgress = p;
      PostTarget.update({ progress: p }, { where: { id: t.id } }).catch(() => {});
    },
    setStatus: (s) => PostTarget.update({ status: s }, { where: { id: t.id } }),
  };
  try {
    await t.update({ status: 'uploading', started_at: t.started_at || new Date(), progress: 0 });
    await Post.update({ status: 'publishing' }, { where: { id: post.id } });
    const accModel = await PlatformAccount.findOne({ where: { platform: t.platform } });
    if (!accModel) throw new PublishError(`${t.platform} is not connected`, { reconnect: true });
    ctx.account = await ensureFresh(accModel);
    await log(t.id, 'info', `Publishing to ${t.platform} (attempt ${t.attempts + 1})`);
    const res = await adapters[t.platform].publish(ctx);
    await t.update({
      status: 'published', progress: 100, external_id: res.externalId, external_url: res.url,
      error_message: null, error_raw: null, locked_at: null, finished_at: new Date(),
    });
    await log(t.id, 'info', `Published: ${res.url || res.externalId}`);
  } catch (e) {
    const err = e instanceof PublishError ? e : fromHttp(e);
    const attempts = t.attempts + 1;
    const retry = err.retryable && attempts < MAX_ATTEMPTS;
    await log(t.id, 'error', err.message, err.raw);
    if (err.reconnect) await PlatformAccount.update({ status: 'expired' }, { where: { platform: t.platform } });
    await PostTarget.update({
      status: retry ? 'pending' : 'failed', attempts, locked_at: null, progress: 0,
      next_attempt_at: retry ? new Date(Date.now() + BACKOFF_MIN[attempts - 1] * 60000) : null,
      error_message: err.message, error_raw: err.raw || null, finished_at: retry ? null : new Date(),
    }, { where: { id: t.id } });
    if (retry) await log(t.id, 'warn', `Will retry in ${BACKOFF_MIN[attempts - 1]} min`);
  } finally {
    await updatePostStatus(post.id).catch((e) => console.error(e));
  }
}

async function tick() {
  if (running >= MAX_CONCURRENT) return;
  try {
    const jobs = await claim(MAX_CONCURRENT - running);
    for (const j of jobs) {
      running++;
      runTarget(j).catch((e) => console.error('runTarget crashed', e)).finally(() => { running--; });
    }
  } catch (e) { console.error('Worker tick failed:', e.message); }
}

// ---- housekeeping jobs ----
async function cleanupMedia() {
  const cutoff = new Date(Date.now() - env.MEDIA_RETENTION_DAYS * 86400000);
  const posts = await Post.findAll({ where: { status: { [Op.in]: ['completed', 'partial', 'failed'] }, updated_at: { [Op.lt]: cutoff } }, include: [{ model: MediaFile, as: 'media' }] });
  let n = 0;
  for (const p of posts) for (const m of p.media) { await media.removeFiles(m.stored_path).catch(() => {}); n++; }
  if (n) console.log(`Cleanup: checked ${n} media file(s) older than ${env.MEDIA_RETENTION_DAYS} days`);
}

async function tokenHealth() {
  for (const acc of await PlatformAccount.findAll()) {
    if (acc.token_expires_at && new Date(acc.token_expires_at) < new Date() && acc.platform !== 'youtube') {
      await acc.update({ status: 'expired' });
      continue;
    }
    await testAccount(acc);
  }
}

async function start() {
  await recover();
  timer = setInterval(tick, TICK_MS);
  tick();
  const safe = (fn) => () => fn().catch((e) => console.error(`${fn.name} failed:`, e.message));
  setInterval(safe(cleanupMedia), 6 * 3600 * 1000);
  setInterval(safe(tokenHealth), 12 * 3600 * 1000);
  setTimeout(safe(tokenHealth), 30 * 1000);
  console.log('Publisher worker started');
}

function stop() { if (timer) clearInterval(timer); }
module.exports = { start, stop };
