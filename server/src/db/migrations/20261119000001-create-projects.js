'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('projects', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: S.STRING(100), allowNull: false, unique: true },
      color: { type: S.STRING(16), allowNull: false, defaultValue: '#7c5cff' },
      icon: { type: S.STRING(32) },
      description: { type: S.STRING(500) },
      archived_at: { type: S.DATE },
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    });
  },
  async down(q) { await q.dropTable('projects'); },
};
