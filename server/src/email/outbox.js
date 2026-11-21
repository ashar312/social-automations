'use strict';
const { Op, UniqueConstraintError } = require('sequelize');
const { EmailOutbox, User } = require('../db/models');
const { encrypt } = require('../services/crypto');
const { PRIORITY, wants } = require('./prefs');

/**
 * Adds an email to the outbox. Enqueuing the same (user, type, dedupeKey) twice is a no-op and returns null.
 * Optional emails the user switched off are not enqueued at all.
 * opts: { payload, secret (encrypted at rest), sendAfter, user (already loaded) }
 */
async function enqueue(userId, type, dedupeKey, opts = {}) {
  const user = opts.user || await User.findByPk(userId);
  if (!user || user.disabled_at) return null;
  if (!wants(user, type)) return null;
  try {
    return await EmailOutbox.create({
      user_id: user.id, type, dedupe_key: String(dedupeKey).slice(0, 100), to_email: user.email, priority: PRIORITY[type] || 3,
      payload: opts.payload || null, payload_secret: opts.secret ? encrypt(opts.secret) : null,
      status: 'queued', send_after: opts.sendAfter || new Date(),
    });
  } catch (e) {
    if (e instanceof UniqueConstraintError) return null;
    throw e;
  }
}

/** Never lets an email problem break the request that triggered it. */
async function enqueueSafe(...args) {
  try { return await enqueue(...args); } catch (e) { console.error('[email] enqueue failed:', e.message); return null; }
}

/** Cancels queued emails of a user (optionally one type). */
const cancel = (userId, type) =>
  EmailOutbox.update({ status: 'cancelled', payload_secret: null }, { where: { user_id: userId, status: 'queued', ...(type ? { type } : {}) } });

/** Asks the sender to run now (urgent mail). */
function kick() { try { require('./sender').kick(); } catch { /* engine off */ } }

/** Was a mail of these types sent, or still waiting, for the user since `since`? */
const recentCount = (userId, types, since) => EmailOutbox.count({
  where: {
    user_id: userId, type: { [Op.in]: types },
    [Op.or]: [{ status: 'sent', sent_at: { [Op.gte]: since } }, { status: { [Op.in]: ['queued', 'sending'] } }],
  },
});

module.exports = { enqueue, enqueueSafe, cancel, kick, recentCount };
