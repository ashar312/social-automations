'use strict';
const { layout, p, esc } = require('./layout');

const STEPS = ['Create a project for a brand, client or channel.', 'Connect LinkedIn, YouTube, Facebook or Instagram to it.', 'Compose a post and publish it now or schedule it.'];

function render({ user, secret, links }) {
  const verify = !user.email_verified_at && secret;
  const url = verify ? `${links.app}/verify-email?token=${encodeURIComponent(secret)}` : links.app;
  const first = String(user.name).split(' ')[0];
  return {
    subject: 'Welcome to Social Automations',
    ...layout({ user, links }, {
      preheader: 'Three steps to your first scheduled post.',
      heading: `Welcome, ${first}!`,
      html: p('Social Automations publishes and schedules your posts to all your social channels from one place. Getting started takes three steps:')
        + `<ol style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;color:#1f2330">${STEPS.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
        + (verify ? p('First, please confirm this is your email address. The link works for 48 hours.') : ''),
      text: `Social Automations publishes and schedules your posts to all your social channels from one place.\n\n${STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}${verify ? '\n\nFirst, please confirm this is your email address. The link works for 48 hours.' : ''}`,
      button: { label: verify ? 'Verify email' : 'Open the app', url },
    }),
  };
}
const sample = () => ({ payload: {}, secret: 'sample-verify-token', data: null });
module.exports = { render, sample };
