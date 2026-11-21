'use strict';
// Usage: npm run email:test -- --to you@example.com --type daily_summary
// Renders a template with sample data and sends it (or logs it when EMAIL_DRY_RUN=true / SMTP is not set up in development).
const { renderSample, TYPES } = require('../src/email/preview');
const { deliver } = require('../src/services/mailer');

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const to = arg('to');
const type = arg('type');
if (!to || !TYPES.includes(type)) {
  console.error(`Usage: npm run email:test --prefix server -- --to you@example.com --type <${TYPES.join('|')}>`);
  process.exit(1);
}
const user = { id: 0, name: 'Test User', email: to, email_verified_at: null, timezone: 'Asia/Karachi' };
const out = renderSample(type, user);
deliver({ to, subject: `[test] ${out.subject}`, html: out.html, text: out.text, headers: out.headers })
  .then((r) => { console.log('Sent', r.messageId); process.exit(0); })
  .catch((e) => { console.error('Failed:', e.message); process.exit(1); });
