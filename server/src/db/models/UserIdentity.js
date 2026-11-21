'use strict';
module.exports = (s, T) => s.define('UserIdentity', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: T.INTEGER, allowNull: false },
  provider: { type: T.ENUM('linkedin', 'facebook', 'instagram'), allowNull: false },
  provider_user_id: { type: T.STRING(191), allowNull: false },
  email: T.STRING(255),
}, { tableName: 'user_identities', underscored: true });
