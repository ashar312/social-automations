'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const env = require('../config/env');
const { User, UserSession, UserIdentity, AuthToken } = require('../db/models');

const COOKIE = 'sa_session';
const DAY = 86400000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rand = () => crypto.randomBytes(32).toString('base64url');
const httpErr = (status, message, code) => Object.assign(new Error(message), { status, code });

const hashPassword = (pw) => bcrypt.hash(pw, 12);
const verifyPassword = (pw, hash) => (hash ? bcrypt.compare(pw, hash) : Promise.resolve(false));
// Constant-ish time for unknown users: compare against a dummy hash
const DUMMY = bcrypt.hashSync('dummy-password-1', 12);
const burn = (pw) => bcrypt.compare(pw, DUMMY);

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw httpErr(400, 'Password must be at least 8 characters');
  if (pw.length > 128) throw httpErr(400, 'Password must be at most 128 characters');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw httpErr(400, 'Password needs at least one letter and one digit');
}
const normEmail = (e) => String(e || '').trim().toLowerCase();
function normPhone(p) {
  if (p == null || String(p).trim() === '') return null;
  const s = String(p).trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw httpErr(400, 'Phone number must have 7 to 15 digits');
  return (s.startsWith('+') ? '+' : '') + digits;
}

function cookieOptions(maxAgeMs) {
  return { httpOnly: true, sameSite: 'lax', secure: env.HTTPS, path: '/', ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) };
}

/** Creates a session row and sets the cookie on `res`. */
async function createSession(user, req, res) {
  const token = rand();
  const now = new Date();
  await UserSession.create({
    user_id: user.id, token_hash: sha256(token), expires_at: new Date(now.getTime() + env.SESSION_DAYS * DAY), last_seen_at: now,
    user_agent: (req.headers['user-agent'] || '').slice(0, 255) || null, ip: (req.ip || '').slice(0, 64) || null,
  });
  res.cookie(COOKIE, token, cookieOptions(env.SESSION_DAYS * DAY));
  await user.update({ last_login_at: now, last_active_at: now });
}
function clearCookie(res) { res.clearCookie(COOKIE, cookieOptions()); }

const destroySession = (token) => UserSession.destroy({ where: { token_hash: sha256(token) } });
const destroyOtherSessions = (userId, keepSessionId = null) =>
  UserSession.destroy({ where: { user_id: userId, ...(keepSessionId ? { id: { [Op.ne]: keepSessionId } } : {}) } });

/** Resolves a cookie value to { user, session } or null. Slides the expiry. */
async function resolveSession(token) {
  if (!token) return null;
  const session = await UserSession.findOne({ where: { token_hash: sha256(token) } });
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at.getTime() <= now) { await session.destroy(); return null; }
  const user = await User.findByPk(session.user_id);
  if (!user || user.disabled_at) return null;
  const left = session.expires_at.getTime() - now;
  if (left < (env.SESSION_DAYS * DAY) / 2) {
    await session.update({ expires_at: new Date(now + env.SESSION_DAYS * DAY), last_seen_at: new Date(now) });
  } else if (now - session.last_seen_at.getTime() > 5 * 60000) {
    await session.update({ last_seen_at: new Date(now) });
  }
  return { user, session };
}

/** One-time token for password reset / email verification. Returns the raw token (only its hash is stored). */
async function issueToken(userId, purpose) {
  await AuthToken.destroy({ where: { user_id: userId, purpose, used_at: null } });
  const token = rand();
  const ttl = purpose === 'reset_password' ? 30 * 60000 : 48 * 3600000;
  await AuthToken.create({ user_id: userId, purpose, token_hash: sha256(token), expires_at: new Date(Date.now() + ttl) });
  return token;
}
/** Marks the token used and returns it, or null when unknown, expired or already used. */
async function consumeToken(token, purpose) {
  if (!token || typeof token !== 'string') return null;
  const row = await AuthToken.findOne({ where: { token_hash: sha256(token), purpose } });
  if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) return null;
  const [n] = await AuthToken.update({ used_at: new Date() }, { where: { id: row.id, used_at: null } });
  return n ? row : null;
}

async function publicUser(u) {
  const ids = await UserIdentity.findAll({ where: { user_id: u.id } });
  return {
    id: u.id, email: u.email, emailVerified: !!u.email_verified_at, name: u.name, phone: u.phone, avatarUrl: u.avatar_url,
    hasPassword: !!u.password_hash, identities: ids.map((i) => i.provider), createdAt: u.createdAt,
  };
}

module.exports = {
  COOKIE, sha256, rand, httpErr, hashPassword, verifyPassword, burn, validatePassword, normEmail, normPhone,
  createSession, clearCookie, destroySession, destroyOtherSessions, resolveSession, issueToken, consumeToken, publicUser,
};
