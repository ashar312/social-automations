'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('post_targets', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      post_id: { type: S.INTEGER, allowNull: false, references: { model: 'posts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      platform: { type: S.ENUM('linkedin','youtube','facebook','instagram'), allowNull: false },
      overrides: { type: S.JSON },
      status: { type: S.ENUM('pending','uploading','processing','published','failed','skipped'), allowNull: false, defaultValue: 'pending' },
      progress: { type: S.TINYINT, allowNull: false, defaultValue: 0 },
      attempts: { type: S.TINYINT, allowNull: false, defaultValue: 0 },
      next_attempt_at: { type: S.DATE },
      locked_at: { type: S.DATE },
      external_id: { type: S.STRING(255) },
      external_url: { type: S.STRING(1024) },
      error_message: { type: S.TEXT },
      error_raw: { type: S.JSON },
      started_at: { type: S.DATE },
      finished_at: { type: S.DATE },
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    });
    await q.addIndex('post_targets', ['post_id', 'platform'], { unique: true, name: 'post_targets_post_platform_uq' });
    await q.addIndex('post_targets', ['status', 'next_attempt_at'], { name: 'post_targets_status_next_attempt' });
  },
  async down(q) { await q.dropTable('post_targets'); },
};
