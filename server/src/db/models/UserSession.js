'use strict';
module.exports = (s, T) => s.define('UserSession', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: T.INTEGER, allowNull: false },
  token_hash: { type: T.CHAR(64), allowNull: false, unique: true },
  expires_at: { type: T.DATE, allowNull: false },
  last_seen_at: { type: T.DATE, allowNull: false },
  user_agent: T.STRING(255),
  ip: T.STRING(64),
}, { tableName: 'user_sessions', underscored: true, updatedAt: false });
