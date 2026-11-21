'use strict';
module.exports = (s, T) => s.define('User', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  email: { type: T.STRING(255), allowNull: false, unique: true },
  email_verified_at: T.DATE,
  password_hash: T.STRING(100), // NULL = social-only account
  name: { type: T.STRING(100), allowNull: false },
  phone: T.STRING(32),
  avatar_url: T.STRING(1000),
  last_login_at: T.DATE,
  disabled_at: T.DATE,
  timezone: { type: T.STRING(64), allowNull: false, defaultValue: 'Asia/Karachi' }, // IANA name
  last_active_at: T.DATE,
  email_prefs: T.JSON, // { dailySummary, productTips, feedback }; NULL = all on
  first_post_published_at: T.DATE,
}, { tableName: 'users', underscored: true });
