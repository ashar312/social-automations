'use strict';
/**
 * Adds ownership. Creates the owner user ashar.ashfaq2@gmail.com (password from env OWNER_PASSWORD, never stored in
 * this file) and gives them every existing project and UI upload. Run `npm run db:backup` first, and delete
 * OWNER_PASSWORD from server/.env afterwards.
 * down() only works while project names are still globally unique (it restores UNIQUE(name)).
 */
const bcrypt = require('bcryptjs');
const OWNER_EMAIL = 'ashar.ashfaq2@gmail.com';

module.exports = {
  async up(q, S) {
    const pw = process.env.OWNER_PASSWORD;
    if (!pw) throw new Error('OWNER_PASSWORD is empty. Set it in server/.env for this migration, then remove it afterwards.');
    const t = await q.sequelize.transaction();
    try {
      const now = new Date();
      await q.bulkInsert('users', [{
        email: OWNER_EMAIL, email_verified_at: now, password_hash: bcrypt.hashSync(pw, 12),
        name: 'Ashar Ashfaq', created_at: now, updated_at: now,
      }], { transaction: t });
      const [[owner]] = await q.sequelize.query('SELECT id FROM users WHERE email = ?', { replacements: [OWNER_EMAIL], transaction: t });

      // projects.user_id
      await q.addColumn('projects', 'user_id', { type: S.INTEGER, allowNull: true }, { transaction: t });
      await q.sequelize.query('UPDATE projects SET user_id = ?', { replacements: [owner.id], transaction: t });
      await q.changeColumn('projects', 'user_id', { type: S.INTEGER, allowNull: false }, { transaction: t });
      await q.addConstraint('projects', {
        fields: ['user_id'], type: 'foreign key', name: 'projects_user_fk',
        references: { table: 'users', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE', transaction: t,
      });

      // UNIQUE(name) -> UNIQUE(user_id, name)
      const [idx] = await q.sequelize.query("SHOW INDEX FROM projects WHERE Column_name = 'name' AND Non_unique = 0", { transaction: t });
      for (const name of new Set(idx.map((i) => i.Key_name))) {
        const [cols] = await q.sequelize.query('SHOW INDEX FROM projects WHERE Key_name = ?', { replacements: [name], transaction: t });
        if (cols.length === 1) await q.removeIndex('projects', name, { transaction: t });
      }
      await q.addIndex('projects', ['user_id', 'name'], { unique: true, name: 'projects_user_name_uq', transaction: t });
      await q.addIndex('projects', ['user_id', 'archived_at'], { name: 'projects_user_archived_idx', transaction: t });

      // media_files.user_id
      await q.addColumn('media_files', 'user_id', { type: S.INTEGER, allowNull: true }, { transaction: t });
      await q.sequelize.query('UPDATE media_files m JOIN projects p ON p.id = m.project_id SET m.user_id = p.user_id', { transaction: t });
      await q.sequelize.query('UPDATE media_files SET user_id = ? WHERE user_id IS NULL', { replacements: [owner.id], transaction: t });
      await q.addConstraint('media_files', {
        fields: ['user_id'], type: 'foreign key', name: 'media_files_user_fk',
        references: { table: 'users', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE', transaction: t,
      });

      await q.addColumn('oauth_states', 'user_id', { type: S.INTEGER, allowNull: true }, { transaction: t });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
  },

  async down(q) {
    await q.removeColumn('oauth_states', 'user_id');
    await q.removeConstraint('media_files', 'media_files_user_fk');
    await q.removeColumn('media_files', 'user_id');
    await q.removeIndex('projects', 'projects_user_archived_idx');
    await q.removeIndex('projects', 'projects_user_name_uq');
    await q.removeConstraint('projects', 'projects_user_fk');
    await q.addIndex('projects', ['name'], { unique: true, name: 'name' });
    await q.removeColumn('projects', 'user_id');
    await q.sequelize.query('DELETE FROM users WHERE email = ?', { replacements: [OWNER_EMAIL] });
  },
};
