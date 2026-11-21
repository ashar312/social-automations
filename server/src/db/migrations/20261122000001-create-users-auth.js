'use strict';
// Auth tables: users, social identities, sessions, one-time tokens, sign-in OAuth state. See plans/08-user-accounts-auth.md
module.exports = {
  async up(q, S) {
    const opts = { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
    await q.createTable('users', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      email: { type: S.STRING(255), allowNull: false, unique: true },
      email_verified_at: S.DATE,
      password_hash: S.STRING(100),
      name: { type: S.STRING(100), allowNull: false },
      phone: S.STRING(32),
      avatar_url: S.STRING(1000),
      last_login_at: S.DATE,
      disabled_at: S.DATE,
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    }, opts);

    const userFk = { type: S.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' };

    await q.createTable('user_identities', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: userFk,
      provider: { type: S.ENUM('linkedin', 'facebook', 'instagram'), allowNull: false },
      provider_user_id: { type: S.STRING(191), allowNull: false },
      email: S.STRING(255),
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    }, opts);
    await q.addIndex('user_identities', ['provider', 'provider_user_id'], { unique: true, name: 'user_identities_provider_uq' });
    await q.addIndex('user_identities', ['user_id', 'provider'], { unique: true, name: 'user_identities_user_provider_uq' });

    await q.createTable('user_sessions', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: userFk,
      token_hash: { type: S.CHAR(64), allowNull: false, unique: true },
      expires_at: { type: S.DATE, allowNull: false },
      last_seen_at: { type: S.DATE, allowNull: false },
      user_agent: S.STRING(255),
      ip: S.STRING(64),
      created_at: { type: S.DATE, allowNull: false },
    }, opts);

    await q.createTable('auth_tokens', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: userFk,
      purpose: { type: S.ENUM('reset_password', 'verify_email'), allowNull: false },
      token_hash: { type: S.CHAR(64), allowNull: false, unique: true },
      expires_at: { type: S.DATE, allowNull: false },
      used_at: S.DATE,
      created_at: { type: S.DATE, allowNull: false },
    }, opts);

    await q.createTable('auth_oauth_states', {
      state: { type: S.CHAR(64), primaryKey: true },
      provider: { type: S.ENUM('linkedin', 'facebook', 'instagram'), allowNull: false },
      code_verifier: S.STRING(128),
      nonce: S.STRING(64),
      mode: { type: S.ENUM('login', 'link'), allowNull: false, defaultValue: 'login' },
      user_id: S.INTEGER,
      created_at: { type: S.DATE, allowNull: false },
    }, opts);
  },

  async down(q) {
    for (const t of ['auth_oauth_states', 'auth_tokens', 'user_sessions', 'user_identities', 'users']) await q.dropTable(t);
  },
};
