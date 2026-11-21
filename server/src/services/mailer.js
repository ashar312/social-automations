'use strict';
const nodemailer = require('nodemailer');
const env = require('../config/env');

let transport;
const configured = () => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transport;
}

/** Sends an email. Without SMTP config in development the message (with its links) is logged instead. Never throws. */
async function sendMail({ to, subject, html, text }) {
  if (!configured()) {
    if (env.NODE_ENV === 'production') { console.error('[mail] SMTP not configured; email to %s not sent', to); return false; }
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}`);
    return true;
  }
  try {
    const from = env.SMTP_FROM || env.SMTP_USER;
    await getTransport().sendMail({ from: `"${env.SMTP_FROM_NAME}" <${from}>`, to, subject, html, text });
    return true;
  } catch (e) {
    console.error('[mail] send failed:', e.message);
    return false;
  }
}
module.exports = { sendMail, configured };
