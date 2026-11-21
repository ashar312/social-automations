'use strict';
const { layout, p, esc, platformLabel, joinList } = require('./layout');

function render({ user, payload, links }) {
  const items = payload.items || [];
  const names = joinList([...new Set(items.map((i) => platformLabel(i.platform)))]);
  const verb = items.length > 1 ? 'are' : 'is';
  const rows = items.map((i) => `<tr>
<td style="padding:6px 12px 6px 0;width:40px">${i.avatar ? `<img src="${esc(i.avatar)}" width="36" height="36" alt="" style="border-radius:50%;display:block">` : ''}</td>
<td style="padding:6px 0;font-size:15px;color:#1f2330"><strong>${esc(platformLabel(i.platform))}</strong><br><span style="color:#667085">${esc(i.name)}</span></td></tr>`).join('');
  return {
    subject: `${names} connected to ${payload.projectName}`,
    ...layout({ user, links }, {
      preheader: `${names} ${verb} ready to publish.`,
      heading: `${names} ${verb} connected`,
      html: p(`Project <strong>${esc(payload.projectName)}</strong> can now publish to:`)
        + `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px">${rows}</table>`
        + p('<span style="color:#667085">Wasn&#39;t you? Disconnect it in Connections right away.</span>'),
      text: `Project "${payload.projectName}" can now publish to:\n${items.map((i) => `- ${platformLabel(i.platform)}: ${i.name}`).join('\n')}\n\nWasn't you? Disconnect it in Connections right away.`,
      button: { label: 'Open Connections', url: `${links.connections}?project=${payload.projectId}` },
    }),
  };
}
const sample = () => ({ payload: { projectId: 1, projectName: 'Acme Brand', items: [{ platform: 'facebook', name: 'Acme Page' }, { platform: 'instagram', name: 'acme_official' }] }, secret: null, data: null });
module.exports = { render, sample };
