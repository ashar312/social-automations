'use strict';
const { Sequelize, DataTypes } = require('sequelize');
const config = require('../../config/database')[process.env.NODE_ENV || 'development'];

const sequelize = new Sequelize(config.database, config.username, config.password, config);

const db = { sequelize, Sequelize };
for (const name of ['PlatformAccount', 'Post', 'MediaFile', 'PostTarget', 'OAuthState', 'ActivityLog']) {
  db[name] = require(`./${name}`)(sequelize, DataTypes);
}

db.Post.hasMany(db.MediaFile, { foreignKey: 'post_id', as: 'media', onDelete: 'CASCADE' });
db.MediaFile.belongsTo(db.Post, { foreignKey: 'post_id', as: 'post' });
db.Post.hasMany(db.PostTarget, { foreignKey: 'post_id', as: 'targets', onDelete: 'CASCADE' });
db.PostTarget.belongsTo(db.Post, { foreignKey: 'post_id', as: 'post' });
db.PostTarget.hasMany(db.ActivityLog, { foreignKey: 'post_target_id', as: 'logs', onDelete: 'CASCADE' });
db.ActivityLog.belongsTo(db.PostTarget, { foreignKey: 'post_target_id', as: 'target' });

module.exports = db;
