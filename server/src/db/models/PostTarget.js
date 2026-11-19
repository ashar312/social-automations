'use strict';
module.exports = (s, T) => s.define('PostTarget', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  post_id: { type: T.INTEGER, allowNull: false },
  platform: { type: T.ENUM('linkedin', 'youtube', 'facebook', 'instagram'), allowNull: false },
  platform_account_id: T.INTEGER,
  overrides: T.JSON,
  status: { type: T.ENUM('pending', 'uploading', 'processing', 'published', 'failed', 'skipped'), allowNull: false, defaultValue: 'pending' },
  progress: { type: T.TINYINT, allowNull: false, defaultValue: 0 },
  attempts: { type: T.TINYINT, allowNull: false, defaultValue: 0 },
  next_attempt_at: T.DATE,
  locked_at: T.DATE,
  external_id: T.STRING(255),
  external_url: T.STRING(1024),
  error_message: T.TEXT,
  error_raw: T.JSON,
  started_at: T.DATE,
  finished_at: T.DATE,
}, { tableName: 'post_targets', underscored: true });
