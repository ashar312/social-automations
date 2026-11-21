'use strict';
const { layout, p, esc, COLOR } = require('./layout');
const { signToken } = require('../prefs');

function render({ user, links }) {
  const t = encodeURIComponent(signToken(user.id, 'feedback'));
  const url = (r) => `${links.app}/feedback?t=${t}&r=${r}`;
  const labels = ['Poor', 'Fair', 'Good', 'Great', 'Excellent'];
  const cells = [1, 2, 3, 4, 5].map((r) => `<td style="padding:0 6px 0 0"><a href="${esc(url(r))}" title="${labels[r - 1]}" style="display:inline-block;width:44px;line-height:44px;text-align:center;border:1px solid ${COLOR.line};border-radius:8px;font-size:17px;font-weight:700;color:${COLOR.brand};text-decoration:none">${r}</a></td>`).join('');
  return {
    subject: 'How was your experience?',
    ...layout({ user, links, category: 'feedback' }, {
      preheader: 'One click, 1 to 5.',
      heading: 'How was your experience?',
      html: p('You published your first post a few days ago. How is Social Automations working for you? Tap a number (5 is best).')
        + `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 8px"><tr>${cells}</tr></table>`
        + p('<span style="color:#667085;font-size:13px">1 = poor &nbsp;·&nbsp; 5 = excellent. You can add a comment on the next page.</span>'),
      text: `You published your first post a few days ago. How is Social Automations working for you? Pick a rating (5 is best):\n\n${[1, 2, 3, 4, 5].map((r) => `${r}: ${url(r)}`).join('\n')}`,
    }),
  };
}
const sample = () => ({ payload: {}, secret: null, data: null });
module.exports = { render, sample };
