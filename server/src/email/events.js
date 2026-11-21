'use strict';
// Entry points the rest of the app calls. Every function swallows its own errors: an email problem never breaks a request.
const { Op } = require('sequelize');
const { EmailOutbox, Project } = require('../db/models');
const A = require('../services/auth');
const outbox = require('./outbox');

const safe = (name, fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { console.error(`[email] ${name} failed:`, e.message); return null; }
};

/** Welcome email right after sign-up (email or social). Holds a 48 h verify token while the address is unverified. */
const welcome = safe('welcome', async (user) => {
  const token = user.email_verified_at ? null : await A.issueToken(user.id, 'verify_email');
  const row = await outbox.enqueue(user.id, 'welcome', 'once', { user, secret: token });
  if (row) outbox.kick();
});

const requestInfo = (req) => ({ ip: String((req && req.ip) || '').slice(0, 64), ua: String((req && req.headers && req.headers['user-agent']) || '').slice(0, 120) });

const passwordChanged = safe('passwordChanged', async (user, req) => {
  const now = Date.now();
  const row = await outbox.enqueue(user.id, 'password_changed', String(now), { user, payload: { at: new Date(now).toISOString(), ...requestInfo(req) } });
  if (row) outbox.kick();
});

/** `token` is the raw reset token; it is stored encrypted and wiped after sending. */
const resetPassword = safe('resetPassword', async (user, token) => {
  const row = await outbox.enqueue(user.id, 'reset_password', A.sha256(token).slice(0, 24), { user, secret: token });
  if (row) outbox.kick();
});

/**
 * After a project connects an account. Only a NEW connection or a reconnect of an expired one (isNew) sends mail.
 * Meta connects Facebook and Instagram in one step: a second call within 2 minutes joins the still-queued email.
 */
const socialConnected = safe('socialConnected', async (account, isNew) => {
  if (!isNew) return;
  const project = await Project.findByPk(account.project_id, { attributes: ['id', 'name', 'user_id'] });
  if (!project) return;
  const item = { platform: account.platform, name: account.display_name, avatar: account.avatar_url || null };
  const open = await EmailOutbox.findOne({
    where: { user_id: project.user_id, type: 'social_connected', status: 'queued', createdAt: { [Op.gt]: new Date(Date.now() - 120000) } },
    order: [['id', 'DESC']],
  });
  if (open && open.payload && open.payload.projectId === project.id) {
    const items = (open.payload.items || []).filter((i) => i.platform !== item.platform).concat(item);
    await open.update({ payload: { ...open.payload, items } });
    return;
  }
  await outbox.enqueue(project.user_id, 'social_connected', `${project.id}:${account.platform}:${Date.now()}`, {
    payload: { projectId: project.id, projectName: project.name, items: [item] },
    sendAfter: new Date(Date.now() + 60000), // gives the second half of a Meta connect time to join
  });
});

module.exports = { welcome, passwordChanged, resetPassword, socialConnected };
