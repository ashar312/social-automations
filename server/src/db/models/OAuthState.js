'use strict';
module.exports = (s, T) => s.define('OAuthState', {
  state: { type: T.CHAR(64), primaryKey: true },
  platform: { type: T.ENUM('linkedin', 'youtube', 'facebook', 'instagram'), allowNull: false },
  code_verifier: T.STRING(128),
}, { tableName: 'oauth_states', underscored: true, updatedAt: false });
