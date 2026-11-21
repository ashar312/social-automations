'use strict';
const { Op } = require('sequelize');
const env = require('../../config/env');
const { User } = require('../../db/models');
const outbox = require('../outbox');
const { build } = require('../templates/dailySummary');
const { parts, localDayRange } = require('../time');

/**
 * Hourly. For every user whose local time is DIGEST_HOUR:00 to DIGEST_HOUR+2:59 (catch-up window), enqueues the summary of
 * their local yesterday, if any scheduled post went out. The dedupe key is that date, so running it twice (or catching up) sends once.
 */
async function run(now = new Date()) {
  const users = await User.findAll({ where: { disabled_at: null } });
  let n = 0;
  for (const user of users) {
    try {
      const h = parts(now, user.timezone).h;
      if (h < env.EMAIL_DIGEST_HOUR || h >= env.EMAIL_DIGEST_HOUR + 3) continue;
      const { date } = localDayRange(now, user.timezone, -1);
      const data = await build(user, date);
      if (!data) continue; // nothing went out: no email
      if (await outbox.enqueue(user.id, 'daily_summary', date, { user, payload: { date } })) n++;
    } catch (e) { console.error(`[email] daily summary for user ${user.id} failed:`, e.message); }
  }
  if (n) { console.log(`[email] queued ${n} daily summary email(s)`); outbox.kick(); }
  return n;
}
module.exports = { run };
