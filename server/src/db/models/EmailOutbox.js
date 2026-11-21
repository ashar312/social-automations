'use strict';
module.exports = (s, T) => s.define('EmailOutbox', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: T.INTEGER, allowNull: false },
  type: { type: T.ENUM('welcome', 'social_connected', 'password_changed', 'reset_password', 'daily_summary', 'first_post_nudge', 'feedback_request', 'inactive_nudge'), allowNull: false },
  dedupe_key: { type: T.STRING(100), allowNull: false },
  to_email: { type: T.STRING(255), allowNull: false },
  priority: { type: T.TINYINT, allowNull: false, defaultValue: 2 },
  payload: T.JSON,
  payload_secret: T.TEXT, // encrypted; wiped after sending
  status: { type: T.ENUM('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'), allowNull: false, defaultValue: 'queued' },
  send_after: { type: T.DATE, allowNull: false },
  attempts: { type: T.TINYINT, allowNull: false, defaultValue: 0 },
  next_attempt_at: T.DATE,
  locked_at: T.DATE,
  sent_at: T.DATE,
  message_id: T.STRING(255),
  error: T.TEXT,
}, { tableName: 'email_outbox', underscored: true });
