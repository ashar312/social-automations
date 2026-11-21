'use strict';
const crypto = require('crypto');
const env = require('../config/env');

/** Which preference switches off which email type. Types not listed here always go out. */
const TYPE_CATEGORY = {
  daily_summary: 'dailySummary',
  first_post_nudge: 'productTips',
  inactive_nudge: 'productTips',
  feedback_request: 'feedback',
};
const CATEGORIES = ['dailySummary', 'productTips', 'feedback'];
const LABELS = { dailySummary: 'daily summary', productTips: 'tips and reminder', feedback: 'feedback request', all: 'optional' };

const PRIORITY = { reset_password: 1, password_changed: 1, welcome: 2, social_connected: 2, daily_summary: 3, first_post_nudge: 4, feedback_request: 4, inactive_nudge: 4 };
const LIFECYCLE = ['first_post_nudge', 'feedback_request', 'inactive_nudge'];
const isOptional = (type) => !!TYPE_CATEGORY[type];

function getPrefs(user) {
  const p = user.email_prefs || {};
  return { dailySummary: p.dailySummary !== false, productTips: p.productTips !== false, feedback: p.feedback !== false };
}
/** false when the user switched this type's category off. */
const wants = (user, type) => !TYPE_CATEGORY[type] || getPrefs(user)[TYPE_CATEGORY[type]];

// ---- signed links (unsubscribe, feedback): HMAC-SHA256 of "userId:category", no expiry ----
const secret = () => env.EMAIL_LINK_SECRET || crypto.createHmac('sha256', Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex')).update('email-link').digest('hex');
const sig = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function signToken(userId, category) {
  const body = Buffer.from(`${userId}:${category}`).toString('base64url');
  return `${body}.${sig(body)}`;
}
/** Returns { userId, category } or null when the token is not ours. */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, s] = token.split('.');
  if (!body || !s) return null;
  const want = Buffer.from(sig(body));
  const got = Buffer.from(s);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const [id, category] = Buffer.from(body, 'base64url').toString().split(':');
  const userId = Number(id);
  return userId > 0 && category ? { userId, category } : null;
}

module.exports = { TYPE_CATEGORY, CATEGORIES, LABELS, PRIORITY, LIFECYCLE, isOptional, getPrefs, wants, signToken, verifyToken };
