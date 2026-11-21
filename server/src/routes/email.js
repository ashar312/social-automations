'use strict';
// Public endpoints behind the signed links in emails (unsubscribe, feedback). No session needed: the HMAC token is the credential.
const router = require('express').Router();
const { z } = require('zod');
const env = require('../config/env');
const { User, EmailFeedback } = require('../db/models');
const { verifyToken, getPrefs, CATEGORIES, LABELS } = require('../email/prefs');
const { httpErr } = require('../services/auth');

const tokenFrom = (req) => String((req.query && req.query.t) || (req.body && req.body.t) || '');

async function setCategory(token, on, allowed) {
  const v = verifyToken(token);
  if (!v || !allowed(v.category)) throw httpErr(400, 'This link is not valid');
  const user = await User.findByPk(v.userId);
  if (!user) throw httpErr(404, 'Account not found');
  const prefs = getPrefs(user);
  for (const c of v.category === 'all' ? CATEGORIES : [v.category]) prefs[c] = on;
  await user.update({ email_prefs: prefs });
  return v.category;
}
const isOptionalCat = (c) => c === 'all' || CATEGORIES.includes(c);

// Link clicked in the email: unsubscribe, then show the confirmation page (which offers Undo)
router.get('/unsubscribe', async (req, res) => {
  const t = tokenFrom(req);
  try {
    const category = await setCategory(t, false, isOptionalCat);
    res.redirect(`${env.CLIENT_URL}/unsubscribed?${new URLSearchParams({ c: LABELS[category] || category, t })}`);
  } catch (e) { res.redirect(`${env.CLIENT_URL}/unsubscribed?${new URLSearchParams({ error: e.message })}`); }
});
// RFC 8058 one-click (Gmail's own Unsubscribe button)
router.post('/unsubscribe', async (req, res, next) => {
  try { await setCategory(tokenFrom(req), false, isOptionalCat); res.json({ ok: true }); } catch (e) { next(e); }
});
router.post('/resubscribe', async (req, res, next) => {
  try { await setCategory(tokenFrom(req), true, isOptionalCat); res.json({ ok: true }); } catch (e) { next(e); }
});

// Rating from the "How was your experience?" email; the comment comes afterwards from the same page
router.post('/feedback', async (req, res, next) => {
  try {
    const d = z.object({ t: z.string(), rating: z.coerce.number().int().min(1).max(5).optional(), comment: z.string().trim().max(2000).optional() }).safeParse(req.body);
    if (!d.success) throw httpErr(400, 'Invalid feedback');
    const v = verifyToken(d.data.t);
    if (!v || v.category !== 'feedback' || !(await User.count({ where: { id: v.userId } }))) throw httpErr(400, 'This link is not valid');
    const row = await EmailFeedback.findOne({ where: { user_id: v.userId } });
    if (!row && !d.data.rating) throw httpErr(400, 'Pick a rating first');
    const patch = {};
    if (d.data.rating) patch.rating = d.data.rating;
    if (d.data.comment !== undefined) patch.comment = d.data.comment || null;
    if (row) await row.update(patch); else await EmailFeedback.create({ user_id: v.userId, ...patch });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
