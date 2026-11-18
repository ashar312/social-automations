'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('posts', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      content_type: { type: S.ENUM('text','image','video','reel'), allowNull: false },
      caption: { type: S.TEXT },
      title: { type: S.STRING(255) },
      status: { type: S.ENUM('draft','queued','publishing','completed','partial','failed'), allowNull: false, defaultValue: 'draft' },
      scheduled_at: { type: S.DATE },
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    });
  },
  async down(q) { await q.dropTable('posts'); },
};
