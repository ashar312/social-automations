'use strict';
const nodemailer = require('nodemailer');
const env = require('../config/env');

let transport;
const configured = () => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      pool: true, maxConnections: 2,
    });
  }
  return transport;
}

/**
 * Sends one email and THROWS on failure (the email engine decides about retries).
 * Without SMTP config in development, or with EMAIL_DRY_RUN=true, the message is logged instead.
 * Returns { messageId }.
 */
async function deliver({ to, subject, html, text, headers }) {
  if (env.EMAIL_DRY_RUN || (!configured() && env.NODE_ENV !== 'production')) {
    console.log(`[mail:${env.EMAIL_DRY_RUN ? 'dry-run' : 'dev'}] to=${to} subject="${subject}"\n${text}`);
    return { messageId: `dry-run-${Date.now()}` };
  }
  if (!configured()) throw Object.assign(new Error('SMTP is not configured'), { code: 'ENOSMTP' });
  const from = env.SMTP_FROM || env.SMTP_USER;
  const info = await getTransport().sendMail({ from: `"${env.SMTP_FROM_NAME}" <${from}>`, to, subject, html, text, headers });
  return { messageId: info.messageId };
}

/** Fire-and-forget style send for direct mail (e.g. "resend verification"). Never throws. */
async function sendMail(msg) {
  try { await deliver(msg); return true; } catch (e) { console.error('[mail] send failed:', e.message); return false; }
}
module.exports = { sendMail, deliver, configured };
