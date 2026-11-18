'use strict';
const router = require('express').Router();
const { PlatformAccount } = require('../db/models');
const { publicView } = require('../services/accounts');
const { testAccount } = require('../services/tokens');

const PLATFORMS = PlatformAccount.PLATFORMS;

router.get('/', async (req, res, next) => {
  try {
    const rows = await PlatformAccount.findAll();
    const by = Object.fromEntries(rows.map((r) => [r.platform, publicView(r)]));
    res.json({ ok: true, connections: PLATFORMS.map((p) => by[p] || { platform: p, status: 'disconnected' }) });
  } catch (e) { next(e); }
});

router.post('/:platform/test', async (req, res, next) => {
  try {
    const acc = await PlatformAccount.findOne({ where: { platform: req.params.platform } });
    if (!acc) return res.status(404).json({ ok: false, error: 'Not connected' });
    const r = await testAccount(acc);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { next(e); }
});

router.delete('/:platform', async (req, res, next) => {
  try {
    const n = await PlatformAccount.destroy({ where: { platform: req.params.platform } });
    res.json({ ok: true, removed: n });
  } catch (e) { next(e); }
});

module.exports = router;
