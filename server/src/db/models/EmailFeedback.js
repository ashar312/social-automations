'use strict';
module.exports = (s, T) => s.define('EmailFeedback', {
  id: { type: T.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: T.INTEGER, allowNull: false, unique: true },
  rating: { type: T.TINYINT, allowNull: false },
  comment: T.TEXT,
}, { tableName: 'email_feedback', underscored: true });
