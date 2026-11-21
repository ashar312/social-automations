'use strict';
const router = require('express').Router();
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { User, AuthOAuthState } = require('../db/models');
const social = require('../services/socialAuth');
const env = require('../config/env');
const A = require('../services/auth');
const emails = require('../services/emails');
const { requireUser } = require('../middleware/auth');

const parse = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) throw A.httpErr(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
};
const limiter = (windowMs, limit, keyFn) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => keyFn(req),
  validate: { keyGeneratorIpFallback: false },
  handler: (req, res) => res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' }),
});
const ip = (req) => req.ip || 'unknown';
const bodyEmail = (req) => A.normEmail(req.body && req.body.email);

const loginLimit = limiter(15 * 60000, 10, (r) => `${ip(r)}|${bodyEmail(r)}`);
const signupLimit = limiter(3600000, 10, ip);
const forgotIp = limiter(3600000, 5, ip);
const forgotEmail = limiter(3600000, 3, (r) => bodyEmail(r) || ip(r));

router.get('/providers', (req, res) => res.json({
  ok: true, email: true, linkedin: env.AUTH_LINKEDIN_ENABLED, facebook: env.AUTH_FACEBOOK_ENABLED, instagram: env.AUTH_INSTAGRAM_ENABLED,
}));

const signup = z.object({ name: z.string().trim().min(1, 'Name is required').max(100), email: z.string().trim().email('Enter a valid email').max(255), password: z.string() });
router.post('/signup', signupLimit, async (req, res, next) => {
  try {
    const d = parse(signup, req.body);
    A.validatePassword(d.password);
    const email = A.normEmail(d.email);
    if (await User.findOne({ where: { email } })) throw A.httpErr(409, 'An account with this email already exists');
    const user = await User.create({ email, name: d.name, password_hash: await A.hashPassword(d.password) });
    A.issueToken(user.id, 'verify_email').then((t) => emails.verifyEmail(user, t)).catch((e) => console.error('[auth] verify email:', e.message));
    await A.createSession(user, req, res);
    res.status(201).json({ ok: true, user: await A.publicUser(user) });
  } catch (e) { next(e); }
});

router.post('/login', loginLimit, async (req, res, next) => {
  try {
    const d = parse(z.object({ email: z.string(), password: z.string() }), req.body);
    const user = await User.findOne({ where: { email: A.normEmail(d.email) } });
    const ok = user && user.password_hash ? await A.verifyPassword(d.password, user.password_hash) : (await A.burn(d.password), false);
    if (!ok || user.disabled_at) throw A.httpErr(401, 'Wrong email or password');
    await A.createSession(user, req, res);
    res.json({ ok: true, user: await A.publicUser(user) });
  } catch (e) { next(e); }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies[A.COOKIE];
    if (token) await A.destroySession(token);
    A.clearCookie(res);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/me', requireUser, async (req, res, next) => {
  try { res.json({ ok: true, user: await A.publicUser(req.user) }); } catch (e) { next(e); }
});

router.post('/forgot-password', forgotIp, forgotEmail, async (req, res, next) => {
  try {
    const d = parse(z.object({ email: z.string() }), req.body);
    const user = await User.findOne({ where: { email: A.normEmail(d.email) } });
    if (user && !user.disabled_at) {
      try { emails.resetPassword(user, await A.issueToken(user.id, 'reset_password')); } catch (e) { console.error('[auth] reset email:', e.message); }
    }
    res.json({ ok: true, message: 'If that email exists, we sent a link.' });
  } catch (e) { next(e); }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const d = parse(z.object({ token: z.string(), password: z.string() }), req.body);
    A.validatePassword(d.password);
    const row = await A.consumeToken(d.token, 'reset_password');
    if (!row) throw A.httpErr(400, 'This link has expired or was already used');
    const user = await User.findByPk(row.user_id);
    if (!user || user.disabled_at) throw A.httpErr(400, 'This link has expired or was already used');
    await user.update({ password_hash: await A.hashPassword(d.password) });
    await A.destroyOtherSessions(user.id);
    emails.passwordChanged(user);
    await A.createSession(user, req, res);
    res.json({ ok: true, user: await A.publicUser(user) });
  } catch (e) { next(e); }
});

router.post('/verify-email', async (req, res, next) => {
  try {
    const d = parse(z.object({ token: z.string() }), req.body);
    const row = await A.consumeToken(d.token, 'verify_email');
    if (!row) throw A.httpErr(400, 'This link has expired or was already used');
    await User.update({ email_verified_at: new Date() }, { where: { id: row.user_id, email_verified_at: null } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/resend-verification', requireUser, async (req, res, next) => {
  try {
    if (req.user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
    const sent = await emails.verifyEmail(req.user, await A.issueToken(req.user.id, 'verify_email'));
    res.json({ ok: true, sent });
  } catch (e) { next(e); }
});

// Instagram returns no email: the user types one here to finish sign-up (verification mail is sent)
router.post('/finish', signupLimit, async (req, res, next) => {
  try {
    const d = parse(z.object({ sel: z.string(), email: z.string().trim().email('Enter a valid email').max(255) }), req.body);
    const prof = social.takePending(d.sel);
    if (!prof) throw A.httpErr(400, 'This step expired. Start again from the sign-in page.');
    const user = await social.finishSignup(prof.provider, prof, A.normEmail(d.email)); // on error the step stays open for another email
    social.dropPending(d.sel);
    A.issueToken(user.id, 'verify_email').then((t) => emails.verifyEmail(user, t)).catch((e) => console.error('[auth] verify email:', e.message));
    await A.createSession(user, req, res);
    res.status(201).json({ ok: true, user: await A.publicUser(user) });
  } catch (e) { next(e); }
});

// ---- Social sign-in (identity only; connecting a project to LinkedIn is a separate flow in routes/oauth.js) ----
router.get('/:provider/start', async (req, res, next) => {
  try {
    const p = social.get(req.params.provider);
    if (!p) return res.status(404).json({ ok: false, error: 'Not available' });
    const mode = req.query.mode === 'link' ? 'link' : 'login';
    if (mode === 'link' && !req.user) return res.redirect(`${env.CLIENT_URL}/login`);
    await social.purgeStates(AuthOAuthState);
    const state = social.newState();
    const nonce = social.nonce();
    await AuthOAuthState.create({ state, provider: req.params.provider, nonce, mode, user_id: mode === 'link' ? req.user.id : null });
    res.redirect(p.authUrl(state, nonce));
  } catch (e) { next(e); }
});

router.get('/:provider/callback', async (req, res) => {
  const provider = req.params.provider;
  let mode = 'login';
  const fail = (msg) => res.redirect(`${env.CLIENT_URL}${mode === 'link' ? '/settings' : '/login'}?${new URLSearchParams({ error: msg })}`);
  try {
    const p = social.get(provider);
    if (!p) return res.status(404).end();
    if (req.query.error) { return fail(String(req.query.error_description || req.query.error)); }
    const row = await AuthOAuthState.findOne({ where: { state: String(req.query.state || ''), provider } });
    if (!row) return fail('Invalid sign-in state, please try again');
    mode = row.mode;
    await row.destroy();
    if (Date.now() - new Date(row.created_at).getTime() > 600000) return fail('Sign-in expired, please try again');
    if (mode === 'link' && (!req.user || req.user.id !== row.user_id)) return fail('Sign in again, then link from Settings');
    const prof = await p.profile(String(req.query.code));
    const { user, linked, needsEmail } = await social.resolveUser(provider, prof, { mode, linkUser: req.user });
    if (needsEmail) return res.redirect(`${env.CLIENT_URL}/auth/finish?${new URLSearchParams({ sel: social.stashPending({ ...prof, provider }), provider })}`);
    if (linked) return res.redirect(`${env.CLIENT_URL}/settings?linked=${provider}`);
    await A.createSession(user, req, res);
    res.redirect(`${env.CLIENT_URL}/`);
  } catch (e) {
    if (e.status < 500) return fail(e.message);
    console.error(`[auth] ${provider} sign-in failed:`, e.response?.data?.error_description || e.message);
    fail('Sign-in failed, please try again');
  }
});

module.exports = router;
