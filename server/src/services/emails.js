'use strict';
const env = require('../config/env');
const { sendMail } = require('./mailer');

const base = () => env.CLIENT_URL.replace(/\/$/, '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function layout(title, intro, button, link, outro) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#222">
<h2>${esc(title)}</h2><p>${esc(intro)}</p>
${button ? `<p><a href="${esc(link)}" style="background:#7c5cff;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(button)}</a></p>
<p style="font-size:12px;color:#666">Or paste this link into your browser:<br>${esc(link)}</p>` : ''}
<p style="font-size:13px;color:#555">${esc(outro)}</p></div>`;
  const text = `${title}\n\n${intro}\n\n${link ? `${link}\n\n` : ''}${outro}`;
  return { html, text };
}

const verifyEmail = (user, token) => {
  const link = `${base()}/verify-email?token=${token}`;
  return sendMail({ to: user.email, subject: 'Verify your email', ...layout('Verify your email', `Hi ${user.name}, confirm this is your email address.`, 'Verify email', link, 'This link works for 48 hours. If you did not sign up, ignore this email.') });
};
const resetPassword = (user, token) => {
  const link = `${base()}/reset-password?token=${token}`;
  return sendMail({ to: user.email, subject: 'Reset your password', ...layout('Reset your password', 'Use the button below to choose a new password.', 'Reset password', link, 'This link works for 30 minutes and only once. If you did not ask for it, ignore this email.') });
};
const passwordChanged = (user) =>
  sendMail({ to: user.email, subject: 'Your password was changed', ...layout('Your password was changed', 'The password for your account was just changed and other devices were signed out.', null, null, 'If this was not you, reset your password right away.') });

module.exports = { verifyEmail, resetPassword, passwordChanged };
