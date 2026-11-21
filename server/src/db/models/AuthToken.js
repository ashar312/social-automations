'use strict';
module.exports = (s, T) => s.define('AuthToken', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: T.INTEGER, allowNull: false },
  purpose: { type: T.ENUM('reset_password', 'verify_email'), allowNull: false },
  token_hash: { type: T.CHAR(64), allowNull: false, unique: true },
  expires_at: { type: T.DATE, allowNull: false },
  used_at: T.DATE,
}, { tableName: 'auth_tokens', underscored: true, updatedAt: false });
