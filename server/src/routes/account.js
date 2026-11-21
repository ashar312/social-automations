'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { Op } = require('sequelize');
const { UserSession, UserIdentity } = require('../db/models');
const A = require('../services/auth');
const ev = require('../email/events');

const parse = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) throw A.httpErr(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
};

router.patch('/profile', async (req, res, next) => {
  try {
    const d = parse(z.object({
      name: z.string().trim().min(1, 'Name is required').max(100).optional(),
      phone: z.string().max(40).nullish(),
      avatarUrl: z.string().trim().max(1000).url().nullish().or(z.literal('')),
    }), req.body);
    const patch = {};
    if (d.name !== undefined) patch.name = d.name;
    if (d.phone !== undefined) patch.phone = A.normPhone(d.phone);
    if (d.avatarUrl !== undefined) patch.avatar_url = d.avatarUrl || null;
    await req.user.update(patch);
    res.json({ ok: true, user: await A.publicUser(req.user) });
  } catch (e) { next(e); }
});

router.post('/password', async (req, res, next) => {
  try {
    const d = parse(z.object({ currentPassword: z.string().optional(), newPassword: z.string() }), req.body);
    if (req.user.password_hash) {
      if (!d.currentPassword || !(await A.verifyPassword(d.currentPassword, req.user.password_hash))) throw A.httpErr(400, 'Current password is wrong');
    }
    A.validatePassword(d.newPassword);
    await req.user.update({ password_hash: await A.hashPassword(d.newPassword) });
    await A.destroyOtherSessions(req.user.id, req.session.id);
    ev.passwordChanged(req.user, req);
    res.json({ ok: true, user: await A.publicUser(req.user) });
  } catch (e) { next(e); }
});

// ---- Email notifications (plans/09-email-engine.md) ----
const { getPrefs } = require('../email/prefs');
const { validTimezone } = require('../email/time');
router.get('/notifications', (req, res) => res.json({ ok: true, prefs: getPrefs(req.user), timezone: req.user.timezone }));
router.patch('/notifications', async (req, res, next) => {
  try {
    const d = parse(z.object({
      dailySummary: z.boolean().optional(), productTips: z.boolean().optional(), feedback: z.boolean().optional(), timezone: z.string().max(64).optional(),
    }), req.body);
    const patch = {};
    const prefs = getPrefs(req.user);
    for (const k of ['dailySummary', 'productTips', 'feedback']) if (d[k] !== undefined) prefs[k] = d[k];
    patch.email_prefs = prefs;
    if (d.timezone !== undefined) {
      if (!validTimezone(d.timezone)) throw A.httpErr(400, 'Unknown time zone');
      patch.timezone = d.timezone;
    }
    await req.user.update(patch);
    res.json({ ok: true, prefs: getPrefs(req.user), timezone: req.user.timezone });
  } catch (e) { next(e); }
});

router.get('/sessions', async (req, res, next) => {
  try {
    const rows = await UserSession.findAll({ where: { user_id: req.user.id, expires_at: { [Op.gt]: new Date() } }, order: [['last_seen_at', 'DESC']] });
    res.json({ ok: true, sessions: rows.map((s) => ({ id: s.id, userAgent: s.user_agent, ip: s.ip, lastSeenAt: s.last_seen_at, createdAt: s.createdAt, current: s.id === req.session.id })) });
  } catch (e) { next(e); }
});
router.delete('/sessions', async (req, res, next) => {
  try { res.json({ ok: true, removed: await A.destroyOtherSessions(req.user.id, req.session.id) }); } catch (e) { next(e); }
});
router.delete('/sessions/:id', async (req, res, next) => {
  try {
    const n = await UserSession.destroy({ where: { id: Number(req.params.id) || 0, user_id: req.user.id } });
    if (!n) throw A.httpErr(404, 'Session not found');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/identities/:provider', async (req, res, next) => {
  try {
    const ids = await UserIdentity.findAll({ where: { user_id: req.user.id } });
    const row = ids.find((i) => i.provider === req.params.provider);
    if (!row) throw A.httpErr(404, 'Not linked');
    if (!req.user.password_hash && ids.length < 2) throw A.httpErr(400, 'This is your only sign-in method. Set a password first.');
    await row.destroy();
    res.json({ ok: true, user: await A.publicUser(req.user) });
  } catch (e) { next(e); }
});

module.exports = router;
