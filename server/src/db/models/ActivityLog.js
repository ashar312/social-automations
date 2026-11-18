'use strict';
module.exports = (s, T) => s.define('ActivityLog', {
  id: { type: T.BIGINT, autoIncrement: true, primaryKey: true },
  post_target_id: T.INTEGER,
  level: { type: T.ENUM('info', 'warn', 'error'), allowNull: false, defaultValue: 'info' },
  message: { type: T.STRING(1024), allowNull: false },
  data: T.JSON,
}, { tableName: 'activity_logs', underscored: true, updatedAt: false });
