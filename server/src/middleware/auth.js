'use strict';
const env = require('../config/env');
const { COOKIE, resolveSession } = require('../services/auth');

/** Reads the session cookie and sets req.user / req.session (both undefined when signed out). */
async function loadUser(req, res, next) {
  try {
    const r = await resolveSession(req.cookies && req.cookies[COOKIE]);
    if (r) {
      req.user = r.user; req.session = r.session;
      const last = r.user.last_active_at;
      if (!last || Date.now() - last.getTime() > 10 * 60000) r.user.update({ last_active_at: new Date() }).catch(() => {});
    }
    next();
  } catch (e) { next(e); }
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Sign in required', code: 'AUTH_REQUIRED' });
  next();
}

const allowed = () => [env.CLIENT_URL, env.SERVER_URL].map((u) => new URL(u).origin);
/** State-changing requests must come from our own origin (when the browser sends one). */
function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !allowed().includes(origin)) return res.status(403).json({ ok: false, error: 'Bad origin' });
  next();
}
module.exports = { loadUser, requireUser, checkOrigin };
