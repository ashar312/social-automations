'use strict';
module.exports = (s, T) => s.define('AuthOAuthState', {
  state: { type: T.CHAR(64), primaryKey: true },
  provider: { type: T.ENUM('linkedin', 'facebook', 'instagram'), allowNull: false },
  code_verifier: T.STRING(128),
  nonce: T.STRING(64),
  mode: { type: T.ENUM('login', 'link'), allowNull: false, defaultValue: 'login' },
  user_id: T.INTEGER,
}, { tableName: 'auth_oauth_states', underscored: true, updatedAt: false });
