'use strict';
module.exports = (s, T) => s.define('Post', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  content_type: { type: T.ENUM('text', 'image', 'video', 'reel', 'document'), allowNull: false },
  caption: T.TEXT,
  title: T.STRING(400),
  status: { type: T.ENUM('draft', 'queued', 'publishing', 'completed', 'partial', 'failed'), allowNull: false, defaultValue: 'draft' },
  project_id: { type: T.INTEGER, allowNull: false },
  scheduled_at: T.DATE,
  created_via: T.STRING(64), // null = app UI, "api", "mcp:<client>"
}, { tableName: 'posts', underscored: true });
