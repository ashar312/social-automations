'use strict';
const { layout, esc, trunc, COLOR, platformLabel } = require('./layout');
const D = require('../data');
const { fmtTime, localDate } = require('../time');

/** Builds the summary data for the user's local `date` (YYYY-MM-DD). Returns null when nothing went out. */
async function build(user, date) {
  const { start, end } = D.rangeForDate(date, user.timezone);
  const rows = await D.finishedScheduled(user.id, start, end);
  if (!rows.length) return null;
  const now = new Date();
  const today = D.rangeForDate(localDate(now, user.timezone), user.timezone);
  const coming = await D.upcoming(user.id, now, today.end, 200);
  const posts = rows.map((r) => ({
    id: r.post.id, type: r.post.content_type, caption: trunc(r.post.caption || r.post.title, 80), at: r.post.scheduled_at,
    project: { name: r.project.name, color: r.project.color },
    targets: r.targets.map((t) => ({ platform: t.platform, ok: t.status === 'published', url: t.external_url, error: trunc(t.error_message, 80) })),
  }));
  const failed = posts.filter((x) => x.targets.some((t) => !t.ok)).length;
  return { date, posts, failed, ok: posts.length - failed, comingCount: coming.length, coming: coming.slice(0, 3).map((c) => ({ at: c.scheduled_at, caption: trunc(c.caption || c.title, 60) })) };
}

const prepare = ({ user, payload }) => build(user, payload.date);
const check = ({ data }) => (data ? null : 'nothing went out');

function render({ user, data, links }) {
  const tz = user.timezone;
  const n = data.posts.length;
  const head = data.ok === 0
    ? `None of your ${n} scheduled post${n === 1 ? '' : 's'} went out`
    : `Yesterday: ${n} scheduled post${n === 1 ? '' : 's'} went out${data.failed ? ` (${data.failed} with a failure)` : ''}`;
  const byProject = new Map();
  for (const x of data.posts) {
    if (!byProject.has(x.project.name)) byProject.set(x.project.name, { project: x.project, posts: [] });
    byProject.get(x.project.name).posts.push(x);
  }
  let html = '';
  let text = '';
  for (const { project, posts } of byProject.values()) {
    html += `<p style="margin:14px 0 6px;font-size:14px;font-weight:700;color:${COLOR.ink}"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${esc(project.color)};margin-right:7px"></span>${esc(project.name)}</p>`;
    text += `\n${project.name}\n`;
    for (const x of posts) {
      const chips = x.targets.map((t) => (t.ok
        ? `<a href="${esc(t.url || links.history(x.id))}" style="color:#12805c;text-decoration:none">&#10003; ${esc(platformLabel(t.platform))}</a>`
        : `<span style="color:#c0362c">&#10007; ${esc(platformLabel(t.platform))}${t.error ? ` (${esc(t.error)})` : ''}</span>`)).join(' &nbsp; ');
      const retry = x.targets.some((t) => !t.ok) ? ` &nbsp; <a href="${esc(links.history(x.id))}" style="color:${COLOR.brand}">Retry</a>` : '';
      html += `<p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:${COLOR.ink}"><span style="color:${COLOR.muted}">${esc(fmtTime(new Date(x.at), tz))} · ${esc(x.type)}</span><br>${esc(x.caption) || '<em>(no caption)</em>'}<br>${chips}${retry}</p>`;
      text += `- ${fmtTime(new Date(x.at), tz)} ${x.type}: ${x.caption}\n  ${x.targets.map((t) => `${t.ok ? 'OK' : 'FAILED'} ${platformLabel(t.platform)}${t.ok ? (t.url ? ` ${t.url}` : '') : ` ${t.error || ''} (retry: ${links.history(x.id)})`}`).join('\n  ')}\n`;
    }
  }
  if (data.comingCount) {
    html += `<p style="margin:18px 0 6px;font-size:14px;font-weight:700;color:${COLOR.ink}">Coming up today: ${data.comingCount}</p>`
      + data.coming.map((c) => `<p style="margin:0 0 4px;font-size:14px;color:${COLOR.ink}"><span style="color:${COLOR.muted}">${esc(fmtTime(new Date(c.at), tz))}</span> ${esc(c.caption)}</p>`).join('');
    text += `\nComing up today: ${data.comingCount}\n${data.coming.map((c) => `- ${fmtTime(new Date(c.at), tz)} ${c.caption}`).join('\n')}\n`;
  }
  return {
    subject: head,
    ...layout({ user, links, category: 'dailySummary' }, {
      preheader: `${data.ok} published${data.failed ? `, ${data.failed} with a failure` : ''}.`,
      heading: head, html: `${html}<div style="height:8px"></div>`, text, button: { label: 'Open history', url: `${links.app}/history` },
    }),
  };
}
const sample = () => ({
  payload: { date: localDate(new Date(Date.now() - 86400000), 'UTC') }, secret: null,
  data: {
    date: '', ok: 1, failed: 1, comingCount: 2, coming: [{ at: new Date(Date.now() + 3600000), caption: 'Launch teaser' }],
    posts: [
      { id: 1, type: 'image', caption: 'Our spring collection is live!', at: new Date(Date.now() - 20 * 3600000), project: { name: 'Acme Brand', color: '#7c5cff' }, targets: [{ platform: 'linkedin', ok: true, url: 'https://linkedin.com' }, { platform: 'facebook', ok: true }] },
      { id: 2, type: 'video', caption: 'Behind the scenes', at: new Date(Date.now() - 18 * 3600000), project: { name: 'Acme Brand', color: '#7c5cff' }, targets: [{ platform: 'instagram', ok: false, error: 'Token expired, reconnect' }] },
    ],
  },
});
module.exports = { build, prepare, check, render, sample };
