'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('oauth_states', {
      state: { type: S.CHAR(64), primaryKey: true },
      platform: { type: S.ENUM('linkedin','youtube','facebook','instagram'), allowNull: false },
      code_verifier: { type: S.STRING(128) },
      created_at: { type: S.DATE, allowNull: false },
    });
  },
  async down(q) { await q.dropTable('oauth_states'); },
};
