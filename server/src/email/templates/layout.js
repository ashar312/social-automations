'use strict';
const env = require('../../config/env');
const { signToken } = require('../prefs');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => env.CLIENT_URL.replace(/\/$/, '');
const serverBase = () => env.SERVER_URL.replace(/\/$/, '');
const trunc = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Links every template may use. */
function links(user, category) {
  const l = { app: app(), compose: `${app()}/compose`, connections: `${app()}/connections`, settings: `${app()}/settings`, history: (id) => `${app()}/history/${id}` };
  if (category) {
    const t = signToken(user.id, category);
    l.unsubscribe = `${serverBase()}/api/email/unsubscribe?t=${encodeURIComponent(t)}`;
    l.settingsNotifications = `${app()}/settings#notifications`;
  }
  return l;
}

const COLOR = { brand: '#7c5cff', ink: '#1f2330', muted: '#667085', line: '#e6e8ee', bg: '#f4f5f9' };

const p = (html) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${COLOR.ink}">${html}</p>`;
const button = (label, url) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 18px"><tr><td style="background:${COLOR.brand};border-radius:8px"><a href="${esc(url)}" style="display:inline-block;padding:11px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(label)}</a></td></tr></table>`;
const small = (html) => `<p style="margin:0 0 12px;font-size:12px;line-height:1.5;color:${COLOR.muted}">${html}</p>`;

/**
 * Shared shell. `ctx` = { user, links, category }. Returns { html, text }.
 * c = { preheader, heading, html (body), text (plain body), button: { label, url } }
 */
function layout(ctx, c) {
  const l = ctx.links;
  const foot = ctx.category && l.unsubscribe
    ? `You get this email because of your Social Automations account. <a href="${esc(l.unsubscribe)}" style="color:${COLOR.muted}">Unsubscribe from these emails</a> or <a href="${esc(l.settingsNotifications)}" style="color:${COLOR.muted}">change what you get</a>.`
    : 'You get this email because of your Social Automations account.';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${COLOR.bg}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(c.preheader || '')}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${COLOR.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif">
<tr><td style="padding:0 4px 14px;font-size:17px;font-weight:700;color:${COLOR.ink}"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${COLOR.brand};margin-right:8px"></span>Social Automations</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${COLOR.line};border-radius:12px;padding:28px 28px 14px">
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:${COLOR.ink}">${esc(c.heading)}</h1>
${c.html}
${c.button ? button(c.button.label, c.button.url) : ''}
</td></tr>
<tr><td style="padding:16px 8px 0">${small(foot)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [c.heading, '', c.text, c.button ? `\n${c.button.label}: ${c.button.url}` : '', '', '--', ctx.category && l.unsubscribe ? `Unsubscribe: ${l.unsubscribe}` : 'You get this email because of your Social Automations account.']
    .join('\n').replace(/\n{3,}/g, '\n\n');
  return { html, text };
}

const PLATFORM_LABEL = { linkedin: 'LinkedIn', youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram' };
const platformLabel = (p0) => PLATFORM_LABEL[p0] || p0;
const joinList = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

module.exports = { esc, trunc, links, layout, p, button, small, COLOR, platformLabel, joinList };
