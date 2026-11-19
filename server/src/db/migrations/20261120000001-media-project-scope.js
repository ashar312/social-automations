'use strict';
/**
 * media_files.project_id: which project an upload belongs to. Set by the external API / MCP on upload so a key
 * can only attach its own project's media (see plans/05-mcp-server.md 2.5). NULL for UI uploads not yet in a post.
 * posts.created_via: where a post came from ("api", "mcp:<client name>"); NULL = the app UI.
 */
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.addColumn('media_files', 'project_id', { type: S.INTEGER, allowNull: true }, { transaction });
      await q.sequelize.query(
        'UPDATE media_files m JOIN posts p ON p.id = m.post_id SET m.project_id = p.project_id', { transaction });
      await q.addConstraint('media_files', {
        fields: ['project_id'], type: 'foreign key', name: 'media_files_project_fk',
        references: { table: 'projects', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE', transaction,
      });
      await q.addColumn('posts', 'created_via', { type: S.STRING(64), allowNull: true }, { transaction });
    });
  },
  async down(q) {
    await q.removeColumn('posts', 'created_via');
    await q.removeConstraint('media_files', 'media_files_project_fk');
    await q.removeColumn('media_files', 'project_id');
  },
};
