'use strict';
const { layout, p, platformLabel, joinList } = require('./layout');
const D = require('../data');

async function prepare({ user }) {
  const accs = await D.connections(user.id);
  return { platforms: [...new Set(accs.filter((a) => a.status === 'connected').map((a) => a.platform))] };
}
async function check({ user }) {
  return (await D.postCount(user.id)) > 0 ? 'user already has posts' : null;
}

function render({ user, data, links }) {
  const connected = data.platforms.length > 0;
  const names = joinList(data.platforms.map(platformLabel));
  return {
    subject: connected ? 'Schedule your first post' : 'Connect a social account and schedule your first post',
    ...layout({ user, links, category: 'productTips' }, {
      preheader: connected ? `You're connected to ${names}.` : 'It takes about two minutes.',
      heading: connected ? 'Ready for your first post?' : 'Connect a channel to get started',
      html: connected
        ? p(`You&#39;re connected to <strong>${names}</strong>. Write a post, pick a time, and we publish it for you.`)
        : p('Connect LinkedIn, YouTube, Facebook or Instagram to a project, then schedule your first post. It takes about two minutes.'),
      text: connected ? `You're connected to ${names}. Write a post, pick a time, and we publish it for you.` : 'Connect LinkedIn, YouTube, Facebook or Instagram to a project, then schedule your first post. It takes about two minutes.',
      button: connected ? { label: 'Schedule a post', url: links.compose } : { label: 'Connect a social account', url: links.connections },
    }),
  };
}
const sample = () => ({ payload: {}, secret: null, data: { platforms: ['linkedin', 'facebook'] } });
module.exports = { render, prepare, check, sample };
