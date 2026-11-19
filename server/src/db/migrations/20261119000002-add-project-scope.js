'use strict';
// Adds project scoping. down() only works while each platform has at most one
// account (the old UNIQUE(platform) rule), otherwise re-adding the index fails.
module.exports = {
  async up(q, S) {
    const t = await q.sequelize.transaction();
    try {
      const now = new Date();
      await q.bulkInsert('projects', [{ name: 'Default', color: '#7c5cff', created_at: now, updated_at: now }], { transaction: t });
      const [[def]] = await q.sequelize.query("SELECT id FROM projects WHERE name = 'Default'", { transaction: t });

      // project_id on platform_accounts and posts: add NULL, backfill, then make NOT NULL + FK
      for (const [table, onDelete] of [['platform_accounts', 'CASCADE'], ['posts', 'RESTRICT']]) {
        await q.addColumn(table, 'project_id', { type: S.INTEGER, allowNull: true }, { transaction: t });
        await q.sequelize.query(`UPDATE ${table} SET project_id = ?`, { replacements: [def.id], transaction: t });
        await q.changeColumn(table, 'project_id', { type: S.INTEGER, allowNull: false }, { transaction: t });
        await q.addConstraint(table, {
          fields: ['project_id'], type: 'foreign key', name: `${table}_project_fk`,
          references: { table: 'projects', field: 'id' }, onDelete, onUpdate: 'CASCADE', transaction: t,
        });
      }

      // platform_accounts: UNIQUE(platform) -> UNIQUE(project_id, platform) + lookup index
      const [idx] = await q.sequelize.query("SHOW INDEX FROM platform_accounts WHERE Column_name = 'platform' AND Non_unique = 0", { transaction: t });
      for (const name of new Set(idx.map((i) => i.Key_name))) {
        const [cols] = await q.sequelize.query('SHOW INDEX FROM platform_accounts WHERE Key_name = ?', { replacements: [name], transaction: t });
        if (cols.length === 1) await q.removeIndex('platform_accounts', name, { transaction: t });
      }
      await q.addIndex('platform_accounts', ['project_id', 'platform'], { unique: true, name: 'platform_accounts_project_platform_uq', transaction: t });
      await q.addIndex('platform_accounts', ['platform', 'external_id'], { name: 'platform_accounts_platform_external', transaction: t });

      await q.addIndex('posts', ['project_id', 'id'], { name: 'posts_project_id_idx', transaction: t });

      // post_targets: snapshot of the account used
      await q.addColumn('post_targets', 'platform_account_id', { type: S.INTEGER, allowNull: true }, { transaction: t });
      await q.addConstraint('post_targets', {
        fields: ['platform_account_id'], type: 'foreign key', name: 'post_targets_platform_account_fk',
        references: { table: 'platform_accounts', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE', transaction: t,
      });
      await q.sequelize.query(
        `UPDATE post_targets t
           JOIN posts p ON p.id = t.post_id
           JOIN platform_accounts a ON a.project_id = p.project_id AND a.platform = t.platform
            SET t.platform_account_id = a.id`, { transaction: t });

      await q.addColumn('oauth_states', 'project_id', { type: S.INTEGER, allowNull: true }, { transaction: t });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
  },

  async down(q, S) {
    await q.removeColumn('oauth_states', 'project_id');
    await q.removeConstraint('post_targets', 'post_targets_platform_account_fk');
    await q.removeColumn('post_targets', 'platform_account_id');
    await q.removeConstraint('posts', 'posts_project_fk');
    await q.removeIndex('posts', 'posts_project_id_idx');
    await q.removeColumn('posts', 'project_id');
    await q.removeConstraint('platform_accounts', 'platform_accounts_project_fk');
    await q.removeIndex('platform_accounts', 'platform_accounts_platform_external');
    await q.removeIndex('platform_accounts', 'platform_accounts_project_platform_uq');
    await q.addIndex('platform_accounts', ['platform'], { unique: true, name: 'platform' });
    await q.removeColumn('platform_accounts', 'project_id');
  },
};
