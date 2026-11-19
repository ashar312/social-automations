'use strict';
module.exports = {
  async up(q, S) { await q.addColumn('projects', 'settings', { type: S.JSON, allowNull: true }); },
  async down(q) { await q.removeColumn('projects', 'settings'); },
};
