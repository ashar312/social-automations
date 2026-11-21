'use strict';
const { layout, p, esc } = require('./layout');
const { fmtDateTime } = require('../time');

function render({ user, payload, links }) {
  const when = fmtDateTime(new Date(payload.at || Date.now()), user.timezone);
  const rows = [['Time', when], ['Device', payload.ua || 'Unknown'], ['IP address', payload.ip || 'Unknown']];
  return {
    subject: 'Your password was changed',
    ...layout({ user, links }, {
      preheader: 'Your Social Automations password was just changed.',
      heading: 'Your password was changed',
      html: p('The password for your account was just changed and your other devices were signed out.')
        + `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px;font-size:14px;color:#1f2330">${rows.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#667085">${k}</td><td>${esc(String(v).slice(0, 120))}</td></tr>`).join('')}</table>`
        + p('If this was not you, reset your password right away.'),
      text: `The password for your account was just changed and your other devices were signed out.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nIf this was not you, reset your password right away.`,
      button: { label: 'Reset password', url: `${links.app}/forgot-password` },
    }),
  };
}
const sample = () => ({ payload: { at: new Date().toISOString(), ip: '203.0.113.7', ua: 'Chrome on Windows' }, secret: null, data: null });
module.exports = { render, sample };
