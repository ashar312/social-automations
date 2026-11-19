'use strict';
const crypto = require('crypto');

/**
 * External API: every project gets a stable public id (prj_xxx) and can hold one API key.
 * Only the SHA-256 of the key is stored; the key itself is shown once when generated.
 */
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.addColumn('projects', 'public_id', { type: S.STRING(32), allowNull: true }, { transaction });
      await q.addColumn('projects', 'api_key_hash', { type: S.CHAR(64), allowNull: true }, { transaction });
      await q.addColumn('projects', 'api_key_hint', { type: S.STRING(16), allowNull: true }, { transaction });
      await q.addColumn('projects', 'api_key_created_at', { type: S.DATE, allowNull: true }, { transaction });
      await q.addColumn('projects', 'api_key_last_used_at', { type: S.DATE, allowNull: true }, { transaction });

      const [rows] = await q.sequelize.query('SELECT id FROM projects', { transaction });
      for (const r of rows) {
        await q.sequelize.query('UPDATE projects SET public_id = ? WHERE id = ?', {
          replacements: [`prj_${crypto.randomBytes(8).toString('hex')}`, r.id], transaction,
        });
      }
      await q.changeColumn('projects', 'public_id', { type: S.STRING(32), allowNull: false }, { transaction });
      await q.addIndex('projects', ['public_id'], { unique: true, name: 'projects_public_id_uq', transaction });
      await q.addIndex('projects', ['api_key_hash'], { unique: true, name: 'projects_api_key_hash_uq', transaction });
    });
  },
  async down(q) {
    await q.removeIndex('projects', 'projects_api_key_hash_uq');
    await q.removeIndex('projects', 'projects_public_id_uq');
    for (const c of ['api_key_last_used_at', 'api_key_created_at', 'api_key_hint', 'api_key_hash', 'public_id']) {
      await q.removeColumn('projects', c);
    }
  },
};
