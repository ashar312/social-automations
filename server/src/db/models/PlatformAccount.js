'use strict';
const PLATFORMS = ['linkedin', 'youtube', 'facebook', 'instagram'];
module.exports = (s, T) => {
  const M = s.define('PlatformAccount', {
    id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
    platform: { type: T.ENUM(...PLATFORMS), allowNull: false, unique: true },
    external_id: { type: T.STRING(128), allowNull: false },
    display_name: { type: T.STRING(255), allowNull: false },
    avatar_url: T.STRING(1024),
    access_token_enc: { type: T.TEXT, allowNull: false },
    refresh_token_enc: T.TEXT,
    token_expires_at: T.DATE,
    scopes: { type: T.STRING(1024), allowNull: false, defaultValue: '' },
    meta: T.JSON,
    status: { type: T.ENUM('connected', 'expired', 'error'), allowNull: false, defaultValue: 'connected' },
    last_checked_at: T.DATE,
  }, { tableName: 'platform_accounts', underscored: true });
  M.PLATFORMS = PLATFORMS;
  return M;
};
