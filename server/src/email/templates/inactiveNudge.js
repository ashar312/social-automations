'use strict';
const { layout, p, esc, platformLabel } = require('./layout');
const env = require('../../config/env');
const D = require('../data');
const { fmtDate } = require('../time');

async function prepare({ user }) {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400000);
  const scheduled = await D.upcoming(user.id, now, soon, 200);
  const expiring = (await D.connections(user.id)).filter((a) => a.platform !== 'youtube' && a.token_expires_at && new Date(a.token_expires_at) < soon);
  return {
    scheduled: scheduled.length,
    expiring: expiring.map((a) => ({ platform: a.platform, name: a.display_name, expired: new Date(a.token_expires_at) < now })),
    lastPublished: await D.lastPublishedAt(user.id),
  };
}
/** Skip when the user came back since the job queued this. */
async function check({ user }) {
  const cutoff = new Date(Date.now() - env.EMAIL_INACTIVE_DAYS * 86400000);
  return user.last_active_at && user.last_active_at > cutoff ? 'user is active again' : null;
}

function render({ user, data, links }) {
  const lines = [];
  if (data.scheduled) lines.push(`${data.scheduled} post${data.scheduled === 1 ? ' is' : 's are'} scheduled for the next 7 days.`);
  for (const e of data.expiring) lines.push(`Your ${platformLabel(e.platform)} connection (${e.name}) ${e.expired ? 'has expired' : 'expires soon'}. Reconnect it so posts keep going out.`);
  if (data.lastPublished) lines.push(`Your last post went out on ${fmtDate(new Date(data.lastPublished), user.timezone)}.`);
  if (!lines.length) lines.push('Nothing is scheduled right now.');
  return {
    subject: 'We miss you',
    ...layout({ user, links, category: 'productTips' }, {
      preheader: 'Here is what is waiting for you.',
      heading: `We miss you, ${String(user.name).split(' ')[0]}`,
      html: p('It has been a few days since you visited. Here is where things stand:')
        + `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;color:#1f2330">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`,
      text: `It has been a few days since you visited. Here is where things stand:\n\n${lines.map((l) => `- ${l}`).join('\n')}`,
      button: { label: 'Schedule a post', url: links.compose },
    }),
  };
}
const sample = () => ({ payload: {}, secret: null, data: { scheduled: 3, expiring: [{ platform: 'linkedin', name: 'Acme', expired: false }], lastPublished: new Date(Date.now() - 6 * 86400000) } });
module.exports = { render, prepare, check, sample };
