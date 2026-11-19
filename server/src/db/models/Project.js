'use strict';
module.exports = (s, T) => s.define('Project', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: T.STRING(100), allowNull: false, unique: true },
  color: { type: T.STRING(16), allowNull: false, defaultValue: '#7c5cff' },
  icon: T.STRING(32),
  description: T.STRING(500),
  settings: T.JSON, // { captionFooter, hashtags }
  archived_at: T.DATE,
}, { tableName: 'projects', underscored: true });
