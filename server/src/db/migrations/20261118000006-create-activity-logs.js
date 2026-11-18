'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('activity_logs', {
      id: { type: S.BIGINT, autoIncrement: true, primaryKey: true },
      post_target_id: { type: S.INTEGER, references: { model: 'post_targets', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      level: { type: S.ENUM('info','warn','error'), allowNull: false, defaultValue: 'info' },
      message: { type: S.STRING(1024), allowNull: false },
      data: { type: S.JSON },
      created_at: { type: S.DATE, allowNull: false },
    });
    await q.addIndex('activity_logs', ['post_target_id']);
  },
  async down(q) { await q.dropTable('activity_logs'); },
};
