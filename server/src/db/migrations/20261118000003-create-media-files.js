'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('media_files', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      post_id: { type: S.INTEGER, references: { model: 'posts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      position: { type: S.TINYINT, allowNull: false, defaultValue: 0 },
      kind: { type: S.ENUM('image','video','thumbnail'), allowNull: false },
      original_name: { type: S.STRING(255), allowNull: false },
      stored_path: { type: S.STRING(512), allowNull: false },
      public_token: { type: S.CHAR(32), allowNull: false, unique: true },
      mime_type: { type: S.STRING(100), allowNull: false },
      size_bytes: { type: S.BIGINT, allowNull: false },
      width: { type: S.INTEGER },
      height: { type: S.INTEGER },
      duration_sec: { type: S.DECIMAL(8, 2) },
      created_at: { type: S.DATE, allowNull: false },
    });
    await q.addIndex('media_files', ['post_id']);
  },
  async down(q) { await q.dropTable('media_files'); },
};
