'use strict';
// Development only (mounted when NODE_ENV !== 'production'): preview a template, or send it to yourself.
const router = require('express').Router();
const { renderSample } = require('../email/preview');
const { deliver } = require('../services/mailer');

router.get('/:type/preview', (req, res, next) => {
  try {
    const out = renderSample(req.params.type, req.user);
    if (req.query.format === 'text') return res.type('text/plain').send(`Subject: ${out.subject}\n\n${out.text}`);
    res.type('html').send(out.html);
  } catch (e) { next(e); }
});

router.post('/:type/send', async (req, res, next) => {
  try {
    const out = renderSample(req.params.type, req.user);
    const r = await deliver({ to: req.user.email, subject: `[test] ${out.subject}`, html: out.html, text: out.text, headers: out.headers });
    res.json({ ok: true, to: req.user.email, messageId: r.messageId });
  } catch (e) { next(e); }
});
module.exports = router;
