'use strict';
module.exports = (s, T) => s.define('MediaFile', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  post_id: T.INTEGER,
  position: { type: T.TINYINT, allowNull: false, defaultValue: 0 },
  kind: { type: T.ENUM('image', 'video', 'thumbnail'), allowNull: false },
  original_name: { type: T.STRING(255), allowNull: false },
  stored_path: { type: T.STRING(512), allowNull: false },
  public_token: { type: T.CHAR(32), allowNull: false, unique: true },
  mime_type: { type: T.STRING(100), allowNull: false },
  size_bytes: { type: T.BIGINT, allowNull: false },
  width: T.INTEGER,
  height: T.INTEGER,
  duration_sec: T.DECIMAL(8, 2),
}, { tableName: 'media_files', underscored: true, updatedAt: false });
