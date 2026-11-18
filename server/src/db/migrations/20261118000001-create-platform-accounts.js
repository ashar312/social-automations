'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('platform_accounts', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      platform: { type: S.ENUM('linkedin','youtube','facebook','instagram'), allowNull: false, unique: true },
      external_id: { type: S.STRING(128), allowNull: false },
      display_name: { type: S.STRING(255), allowNull: false },
      avatar_url: { type: S.STRING(1024) },
      access_token_enc: { type: S.TEXT, allowNull: false },
      refresh_token_enc: { type: S.TEXT },
      token_expires_at: { type: S.DATE },
      scopes: { type: S.STRING(1024), allowNull: false, defaultValue: '' },
      meta: { type: S.JSON },
      status: { type: S.ENUM('connected','expired','error'), allowNull: false, defaultValue: 'connected' },
      last_checked_at: { type: S.DATE },
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    });
  },
  async down(q) { await q.dropTable('platform_accounts'); },
};
