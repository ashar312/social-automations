'use strict';
// Email engine tables and user columns. See plans/09-email-engine.md
const TYPES = ['welcome', 'social_connected', 'password_changed', 'reset_password', 'daily_summary', 'first_post_nudge', 'feedback_request', 'inactive_nudge'];

module.exports = {
  async up(q, S) {
    const opts = { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
    const userFk = { type: S.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' };

    await q.createTable('email_outbox', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: userFk,
      type: { type: S.ENUM(...TYPES), allowNull: false },
      dedupe_key: { type: S.STRING(100), allowNull: false },
      to_email: { type: S.STRING(255), allowNull: false },
      priority: { type: S.TINYINT, allowNull: false, defaultValue: 2 },
      payload: S.JSON,
      payload_secret: S.TEXT,
      status: { type: S.ENUM('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'), allowNull: false, defaultValue: 'queued' },
      send_after: { type: S.DATE, allowNull: false },
      attempts: { type: S.TINYINT, allowNull: false, defaultValue: 0 },
      next_attempt_at: S.DATE,
      locked_at: S.DATE,
      sent_at: S.DATE,
      message_id: S.STRING(255),
      error: S.TEXT,
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    }, opts);
    await q.addIndex('email_outbox', ['user_id', 'type', 'dedupe_key'], { unique: true, name: 'email_outbox_dedupe_uq' });
    await q.addIndex('email_outbox', ['status', 'priority', 'send_after'], { name: 'email_outbox_due_idx' });
    await q.addIndex('email_outbox', ['user_id', 'type', 'sent_at'], { name: 'email_outbox_user_type_idx' });

    await q.createTable('email_feedback', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: { ...userFk, unique: true },
      rating: { type: S.TINYINT, allowNull: false },
      comment: S.TEXT,
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    }, opts);

    await q.addColumn('users', 'timezone', { type: S.STRING(64), allowNull: false, defaultValue: 'Asia/Karachi' });
    await q.addColumn('users', 'last_active_at', S.DATE);
    await q.addColumn('users', 'email_prefs', S.JSON);
    await q.addColumn('users', 'first_post_published_at', S.DATE);

    // Existing users must not get "first post" / "we miss you" mail on day one.
    const db = q.sequelize;
    await db.query('UPDATE users SET last_active_at = NOW()');
    await db.query(`UPDATE users u SET first_post_published_at = (
      SELECT MIN(t.finished_at) FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN projects pr ON pr.id = p.project_id
      WHERE pr.user_id = u.id AND t.status = 'published')`);
    await db.query(`INSERT INTO email_outbox (user_id, type, dedupe_key, to_email, priority, status, send_after, error, created_at, updated_at)
      SELECT u.id, x.type, 'once', u.email, x.priority, 'skipped', NOW(), 'existing user at migration time', NOW(), NOW()
      FROM users u JOIN (SELECT 'welcome' AS type, 2 AS priority UNION ALL SELECT 'first_post_nudge', 4 UNION ALL SELECT 'feedback_request', 4) x`);
  },

  async down(q) {
    for (const c of ['first_post_published_at', 'email_prefs', 'last_active_at', 'timezone']) await q.removeColumn('users', c);
    await q.dropTable('email_feedback');
    await q.dropTable('email_outbox');
  },
};
