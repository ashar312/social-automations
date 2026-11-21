'use strict';
const { Op } = require('sequelize');
const env = require('../../config/env');
const { User, EmailOutbox } = require('../../db/models');
const outbox = require('../outbox');
const { LIFECYCLE } = require('../prefs');
const { localHour } = require('../time');
const D = require('../data');

const DAY = 86400000;
const QUIET_FROM = 9; // enqueue only between 09:00 and 20:00 local time
const QUIET_TO = 20;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Every 15 minutes. State-based, so it is safe to run late or twice: dedupe keys stop repeats.
 * Per user at most one lifecycle email per 24 h; priority 6 -> 8 -> 7.
 */
async function run(now = new Date()) {
  const t = now.getTime();
  const users = await User.findAll({
    where: {
      disabled_at: null,
      [Op.or]: [{ email_verified_at: { [Op.ne]: null } }, { createdAt: { [Op.gt]: new Date(t - 7 * DAY) } }], // unverified > 7 days: no lifecycle mail
    },
  });
  let n = 0;
  for (const user of users) {
    try {
      const h = localHour(now, user.timezone);
      if (h < QUIET_FROM || h >= QUIET_TO) continue;
      if (user.last_active_at && t - user.last_active_at.getTime() < 3600000) continue; // using the app right now
      if (await outbox.recentCount(user.id, LIFECYCLE, new Date(t - DAY))) continue; // one per 24 h (also while one is still queued)

      const sent = await queue(user, now);
      if (sent) n++;
    } catch (e) { console.error(`[email] lifecycle for user ${user.id} failed:`, e.message); }
  }
  if (n) { console.log(`[email] queued ${n} lifecycle email(s)`); outbox.kick(); }
  return n;
}

async function queue(user, now) {
  const t = now.getTime();
  const age = t - user.createdAt.getTime();

  // 6: first post nudge, 24 h after sign-up and no post at all
  if (age >= DAY && await D.postCount(user.id) === 0) {
    if (await outbox.enqueue(user.id, 'first_post_nudge', 'once', { user })) return true;
  }

  // 8: inactive for N days (account older than that, so email 6 had its chance)
  const idleMs = env.EMAIL_INACTIVE_DAYS * DAY;
  const last = user.last_active_at;
  if (last && t - last.getTime() >= idleMs && age >= idleMs) {
    const prev = await EmailOutbox.findAll({ where: { user_id: user.id, type: 'inactive_nudge', status: 'sent' }, attributes: ['sent_at'], order: [['sent_at', 'DESC']] });
    const unanswered = prev.filter((r) => r.sent_at > last).length;
    const recent = prev.length && t - prev[0].sent_at.getTime() < 14 * DAY;
    if (!recent && unanswered < 3 && await outbox.enqueue(user.id, 'inactive_nudge', ymd(last), { user })) return true;
  }

  // 7: feedback, 3 days after the first published post
  if (user.first_post_published_at && t - user.first_post_published_at.getTime() >= 3 * DAY) {
    if (await outbox.enqueue(user.id, 'feedback_request', 'once', { user })) return true;
  }
  return false;
}
module.exports = { run };
