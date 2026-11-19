'use strict';
module.exports = {
  async up(q, S) {
    await q.changeColumn('oauth_states', 'platform', {
      type: S.ENUM('linkedin', 'youtube', 'facebook', 'instagram', 'meta'), allowNull: false,
    });
  },
  async down(q, S) {
    await q.sequelize.query("DELETE FROM oauth_states WHERE platform='meta'");
    await q.changeColumn('oauth_states', 'platform', {
      type: S.ENUM('linkedin', 'youtube', 'facebook', 'instagram'), allowNull: false,
    });
  },
};
