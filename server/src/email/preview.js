'use strict';
// Renders any template with sample data (dev preview, send-to-myself, CLI test).
const templates = require('./templates');
const { TYPE_CATEGORY, isOptional } = require('./prefs');
const { links } = require('./templates/layout');

const TYPES = Object.keys(templates);

function renderSample(type, user) {
  const tpl = templates[type];
  if (!tpl) throw Object.assign(new Error(`Unknown email type. Use one of: ${TYPES.join(', ')}`), { status: 404 });
  const s = tpl.sample(user);
  const category = TYPE_CATEGORY[type];
  const out = tpl.render({ user, payload: s.payload || {}, secret: s.secret, data: s.data, links: links(user, category), category });
  const headers = {};
  if (isOptional(type)) {
    const l = links(user, category);
    headers['List-Unsubscribe'] = `<${l.unsubscribe}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  return { ...out, headers };
}
module.exports = { renderSample, TYPES };
