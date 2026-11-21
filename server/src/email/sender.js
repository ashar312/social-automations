'use strict';
const { Op } = require('sequelize');
const env = require('../config/env');
const { EmailOutbox, User } = require('../db/models');
const { decrypt } = require('../services/crypto');
const { deliver } = require('../services/mailer');
const templates = require('./templates');
const { links } = require('./templates/layout');
const { TYPE_CATEGORY, isOptional, wants } = require('./prefs');

const STALE_LOCK_MS = 5 * 60000;
const BACKOFF_MIN = [1, 5, 30, 120, 360];
const MAX_ATTEMPTS = 5;
const SECURITY_RETRY_WINDOW_MS = 3600000; // a reset link older than 1 h is useless

let timer = null;
let running = false;
let again = false;

/** Mail the user can still get right now, given the Gmail caps. */
async function budget() {
  const now = Date.now();
  const [perMin, perDay] = await Promise.all([
    EmailOutbox.count({ where: { status: 'sent', sent_at: { [Op.gte]: new Date(now - 60000) } } }),
    EmailOutbox.count({ where: { status: 'sent', sent_at: { [Op.gte]: new Date(now - 86400000) } } }),
  ]);
  return { minute: env.EMAIL_MAX_PER_MINUTE - perMin, day: env.EMAIL_MAX_PER_DAY - perDay };
}

async function recoverStale() {
  await EmailOutbox.update({ status: 'queued', locked_at: null }, { where: { status: 'sending', locked_at: { [Op.lt]: new Date(Date.now() - STALE_LOCK_MS) } } });
}

async function claim(limit, maxPriority) {
  const now = new Date();
  const rows = await EmailOutbox.findAll({
    where: {
      status: 'queued', send_after: { [Op.lte]: now }, priority: { [Op.lte]: maxPriority },
      [Op.or]: [{ next_attempt_at: null }, { next_attempt_at: { [Op.lte]: now } }],
    },
    order: [['priority', 'ASC'], ['id', 'ASC']], limit,
  });
  const mine = [];
  for (const r of rows) {
    const [n] = await EmailOutbox.update({ status: 'sending', locked_at: new Date() }, { where: { id: r.id, status: 'queued' } });
    if (n) mine.push(r);
  }
  return mine;
}

const finish = (row, patch) => row.update({ locked_at: null, ...patch });

/** Renders one outbox row. Returns { skip: reason } or { subject, html, text, headers }. */
async function build(row, user) {
  const tpl = templates[row.type];
  if (!tpl) return { skip: `unknown type ${row.type}` };
  if (!wants(user, row.type)) return { skip: 'user turned this email off' };
  const category = TYPE_CATEGORY[row.type];
  const secret = row.payload_secret ? decrypt(row.payload_secret) : null;
  const ctx = { user, payload: row.payload || {}, secret, links: links(user, category), category };
  if (tpl.prepare) ctx.data = await tpl.prepare(ctx);
  if (tpl.check) { const why = await tpl.check(ctx); if (why) return { skip: why }; }
  const out = tpl.render(ctx);
  const headers = {};
  if (isOptional(row.type) && ctx.links.unsubscribe) {
    headers['List-Unsubscribe'] = `<${ctx.links.unsubscribe}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  return { ...out, headers };
}

function isPermanent(e) {
  const c = Number(e.responseCode);
  if (!(c >= 500 && c < 600)) return false;
  // Gmail answers 550 5.4.5 when the daily quota is used up: that is a "later", not a bad address.
  return !/daily user sending|quota|limit exceeded|5\.4\.5/i.test(String(e.response || e.message));
}

async function sendOne(row) {
  try {
    const user = await User.findByPk(row.user_id);
    if (!user || user.disabled_at) return finish(row, { status: 'skipped', error: 'user missing or disabled', payload_secret: null });
    const out = await build(row, user);
    if (out.skip) return finish(row, { status: 'skipped', error: out.skip, payload_secret: null });
    const res = await deliver({ to: row.to_email, subject: out.subject, html: out.html, text: out.text, headers: out.headers });
    return finish(row, { status: 'sent', sent_at: new Date(), message_id: String(res.messageId || '').slice(0, 255), error: null, payload_secret: null, attempts: row.attempts + 1 });
  } catch (e) {
    const attempts = row.attempts + 1;
    const security = row.priority === 1;
    const tooOld = security && Date.now() - new Date(row.createdAt).getTime() > SECURITY_RETRY_WINDOW_MS;
    const dead = isPermanent(e) || attempts >= MAX_ATTEMPTS || tooOld;
    console.error(`[email] ${row.type} #${row.id} ${dead ? 'failed' : 'will retry'}: ${e.message}`);
    return finish(row, dead
      ? { status: 'failed', attempts, error: String(e.message).slice(0, 1000), payload_secret: null }
      : { status: 'queued', attempts, error: String(e.message).slice(0, 1000), next_attempt_at: new Date(Date.now() + BACKOFF_MIN[attempts - 1] * 60000) });
  }
}

/** One pass: sends what is due, within the rate limits. */
async function run() {
  if (running) { again = true; return 0; }
  running = true;
  let sent = 0;
  try {
    do {
      again = false;
      await recoverStale();
      const b = await budget();
      if (b.minute <= 0) break;
      // when the day cap is hit only security and transactional mail (priority 1-2) keep going
      const maxPriority = b.day > 0 ? 4 : 2;
      const limit = Math.min(env.EMAIL_BATCH, b.minute, maxPriority === 4 ? b.day : env.EMAIL_BATCH);
      const rows = await claim(limit, maxPriority);
      for (const r of rows) { await sendOne(r); sent++; }
      if (rows.length === env.EMAIL_BATCH) again = true;
    } while (again);
  } catch (e) {
    console.error('[email] sender run failed:', e.message);
  } finally { running = false; }
  return sent;
}

function kick() { setImmediate(() => run()); }
function start() { if (!timer) { timer = setInterval(run, 30000); run(); } }
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, kick, run, build };
