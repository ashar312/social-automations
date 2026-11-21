'use strict';
const { Sequelize, DataTypes } = require('sequelize');
const config = require('../../config/database')[process.env.NODE_ENV || 'development'];

const sequelize = new Sequelize(config.database, config.username, config.password, config);

const db = { sequelize, Sequelize };
for (const name of ['User', 'UserIdentity', 'UserSession', 'AuthToken', 'AuthOAuthState', 'Project', 'PlatformAccount', 'Post', 'MediaFile', 'PostTarget', 'OAuthState', 'ActivityLog', 'EmailOutbox', 'EmailFeedback']) {
  db[name] = require(`./${name}`)(sequelize, DataTypes);
}

db.Post.hasMany(db.MediaFile, { foreignKey: 'post_id', as: 'media', onDelete: 'CASCADE' });
db.MediaFile.belongsTo(db.Post, { foreignKey: 'post_id', as: 'post' });
db.Post.hasMany(db.PostTarget, { foreignKey: 'post_id', as: 'targets', onDelete: 'CASCADE' });
db.PostTarget.belongsTo(db.Post, { foreignKey: 'post_id', as: 'post' });
db.PostTarget.hasMany(db.ActivityLog, { foreignKey: 'post_target_id', as: 'logs', onDelete: 'CASCADE' });
db.ActivityLog.belongsTo(db.PostTarget, { foreignKey: 'post_target_id', as: 'target' });

db.User.hasMany(db.Project, { foreignKey: 'user_id', as: 'projects', onDelete: 'CASCADE' });
db.Project.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
db.User.hasMany(db.UserIdentity, { foreignKey: 'user_id', as: 'identities', onDelete: 'CASCADE' });
db.User.hasMany(db.UserSession, { foreignKey: 'user_id', onDelete: 'CASCADE' });

db.Project.hasMany(db.PlatformAccount, { foreignKey: 'project_id', as: 'accounts', onDelete: 'CASCADE' });
db.PlatformAccount.belongsTo(db.Project, { foreignKey: 'project_id', as: 'project' });
db.Project.hasMany(db.Post, { foreignKey: 'project_id', as: 'posts', onDelete: 'RESTRICT' });
db.Post.belongsTo(db.Project, { foreignKey: 'project_id', as: 'project' });
db.PostTarget.belongsTo(db.PlatformAccount, { foreignKey: 'platform_account_id', as: 'account' });

module.exports = db;
