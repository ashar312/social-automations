'use strict';
const crypto = require('crypto');

module.exports = (s, T) => s.define('Project', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  // Stable id used by the external API (/api/v1/projects/:publicId). Never changes, never reused.
  public_id: { type: T.STRING(32), allowNull: false, unique: true, defaultValue: () => `prj_${crypto.randomBytes(8).toString('hex')}` },
  name: { type: T.STRING(100), allowNull: false, unique: true },
  color: { type: T.STRING(16), allowNull: false, defaultValue: '#7c5cff' },
  icon: T.STRING(32),
  description: T.STRING(500),
  settings: T.JSON, // { captionFooter, hashtags }
  api_key_hash: { type: T.CHAR(64), unique: true }, // sha256 of the API key; the key itself is never stored
  api_key_hint: T.STRING(16), // last characters, to recognise a key in the UI
  api_key_created_at: T.DATE,
  api_key_last_used_at: T.DATE,
  archived_at: T.DATE,
}, { tableName: 'projects', underscored: true });
