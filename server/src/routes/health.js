'use strict';
const router = require('express').Router();
const { sequelize } = require('../db/models');

router.get('/', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ ok: true, db: 'connected' });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'disconnected' });
  }
});
module.exports = router;
