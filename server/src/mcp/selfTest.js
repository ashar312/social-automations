'use strict';
/** "Test connection" on the Integration page: connect to our own /api/v1/mcp over HTTP with the given key, like a client would. */
const env = require('../config/env');
const { hash } = require('../services/apiKeys');

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const CERT_CODES = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'];
const certError = (e) => {
  for (let c = e; c; c = c.cause) if (CERT_CODES.includes(c.code)) return true;
  return false;
};

/**
 * Runs the platform rules on an in-memory 3-page PDF (nothing is stored): linkedin should be OK, the others skipped.
 * Returns { ok, results } so the Integration page can show it.
 */
async function carouselCheck() {
  const { evaluate } = require('../platforms/rules');
  const fixture = { kind: 'document', page_count: 3, width: 1080, height: 1350, size_bytes: 50000, original_name: 'selftest.pdf', mime_type: 'application/pdf' };
  const post = { contentType: 'document', caption: 'Self-test', title: 'Self-test carousel', overrides: {} };
  const results = {};
  for (const p of ['linkedin', 'youtube', 'facebook', 'instagram']) results[p] = evaluate(p, post, [fixture], { publicBaseUrl: env.PUBLIC_BASE_URL });
  const ok = results.linkedin.supported && !results.linkedin.errors.length && ['youtube', 'facebook', 'instagram'].every((p) => !results[p].supported);
  return { ok, results };
}

async function selfTest(project, key) {
  if (typeof key !== 'string' || !key.trim()) throw bad('Paste the project API key to test with.');
  if (!project.api_key_hash) throw bad('This project has no API key yet. Generate one first.');
  if (hash(key.trim()) !== project.api_key_hash) throw bad('That key does not belong to this project (or was replaced).');

  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  // loopback works for HOST=127.0.0.1 and HOST=0.0.0.0. Over HTTPS the mkcert cert covers 127.0.0.1;
  // Node trusts it only with --use-system-ca (set in the npm scripts).
  const url = new URL(`${env.SCHEME}://127.0.0.1:${env.PORT}/api/v1/mcp`);
  const client = new Client({ name: 'Social Automations test', version: '1.0.0' });
  const started = Date.now();
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${key.trim()}` } } }));
    const { tools } = await client.listTools();
    const res = await client.callTool({ name: 'get_project', arguments: {} });
    return {
      ms: Date.now() - started,
      server: client.getServerVersion(),
      protocolVersion: client.transport && client.transport.protocolVersion,
      toolCount: tools.length,
      carouselTool: tools.some((t) => t.name === 'build_carousel_pdf'),
      carouselValidation: await carouselCheck(),
      project: res.isError ? null : res.structuredContent,
    };
  } catch (e) {
    const json = String(e.message).match(/\{.*\}$/s);
    let msg = e.message;
    if (json) { try { const b = JSON.parse(json[0]); msg = (b.error && (b.error.message || b.error)) || msg; } catch { /* keep */ } }
    if (certError(e)) msg = 'the server process does not trust the local HTTPS certificate. Start it with node --use-system-ca (npm run dev / npm start do this).';
    throw Object.assign(new Error(`MCP test failed: ${msg}`), { status: 422 }); // < 500 so the error handler shows the message
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { selfTest };
