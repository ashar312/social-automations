#!/usr/bin/env node
'use strict';
/**
 * stdio ⇄ HTTP bridge for MCP clients that only start local (stdio) servers (plans/05-mcp-server.md, D5).
 * It forwards every JSON-RPC message to the app's /api/v1/mcp endpoint; all logic stays in the server.
 *
 *   SA_API_KEY=sa_live_...  (required)  the project's API key
 *   SA_MCP_URL=...          (optional)  default http://127.0.0.1:5000/api/v1/mcp
 *   or: node bin/mcp-stdio.js --url <url> --key <key>
 *
 * Local HTTPS (plans/06-local-https.md): SA_MCP_URL=https://127.0.0.1:5000/api/v1/mcp and run with
 * `node --use-system-ca bin/mcp-stdio.js` (or NODE_OPTIONS=--use-system-ca) so Node trusts the mkcert CA.
 *
 * stdout is the MCP channel: log to stderr only.
 */
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const URL_ = arg('url') || process.env.SA_MCP_URL || 'http://127.0.0.1:5000/api/v1/mcp';
const KEY = arg('key') || process.env.SA_API_KEY;
const log = (...a) => console.error('[social-automations mcp]', ...a);

if (!KEY) {
  log('Set SA_API_KEY to the project API key (Integration page in the app), or pass --key.');
  process.exit(1);
}

/** Readable reason from a failed POST ("Error POSTing to endpoint: {json}") or a network error. */
function reason(e) {
  const json = String(e.message).match(/\{.*\}$/s);
  if (json) {
    try { const b = JSON.parse(json[0]); return (b.error && (b.error.message || b.error)) || e.message; } catch { /* not JSON */ }
  }
  const codes = [];
  for (let c = e; c; c = c.cause) if (c.code) codes.push(c.code);
  if (codes.includes('ECONNREFUSED')) return `Cannot reach ${URL_}. Is the Social Automations server running?`;
  if (codes.some((c) => ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(c))) {
    return `Node doesn't trust the local HTTPS certificate of ${URL_}: run the bridge with node --use-system-ca (or set NODE_OPTIONS=--use-system-ca).`;
  }
  if (codes.includes('ECONNRESET') && URL_.startsWith('http://')) return `Connection reset by ${URL_}. If the server runs HTTPS, use an https:// SA_MCP_URL.`;
  return e.message;
}

async function main() {
  const local = new StdioServerTransport();
  const remote = new StreamableHTTPClientTransport(new URL(URL_), {
    requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
  });
  const initIds = new Set();

  local.onmessage = async (msg) => {
    if (msg.method === 'initialize' && msg.id !== undefined) initIds.add(msg.id);
    try {
      await remote.send(msg);
    } catch (e) {
      const why = reason(e);
      log(`${msg.method || 'message'} failed: ${why}`);
      // answer requests so the client doesn't wait forever
      if (msg.method && msg.id !== undefined) {
        await local.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Social Automations: ${why}` } }).catch(() => {});
      }
    }
  };
  remote.onmessage = async (msg) => {
    // later requests must carry the negotiated MCP-Protocol-Version header
    if (msg.id !== undefined && initIds.delete(msg.id) && msg.result && msg.result.protocolVersion) {
      remote.setProtocolVersion(msg.result.protocolVersion);
    }
    await local.send(msg).catch((e) => log(`stdout write failed: ${e.message}`));
  };
  remote.onerror = (e) => log(reason(e));
  local.onerror = (e) => log(e.message);
  local.onclose = () => { remote.close().finally(() => process.exit(0)); };

  await remote.start();
  await local.start();
  log(`bridging stdio to ${URL_}`);
}

main().catch((e) => { log(e.message); process.exit(1); });
