'use strict';
const crypto = require('crypto');

const PREFIX = 'sa_live_';

const hash = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/** New random key. Returns the plain key (show once) and the fields to store on the project. */
function generate() {
  const key = `${PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
  return { key, fields: { api_key_hash: hash(key), api_key_hint: key.slice(-4), api_key_created_at: new Date(), api_key_last_used_at: null } };
}

/** Reads the key from `Authorization: Bearer <key>` or `X-API-Key: <key>`. */
function fromRequest(req) {
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return (m && m[1]) || req.get('x-api-key') || null;
}

module.exports = { generate, hash, fromRequest, PREFIX };
