'use strict';
/**
 * MCP endpoint: POST /api/v1/mcp (Streamable HTTP, stateless). Auth = the project's API key as a Bearer token.
 * Plan: plans/05-mcp-server.md
 */
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const env = require('../config/env');
const apiAuth = require('../middleware/apiAuth');
const guard = require('./guard');
const { buildMcpServer } = require('./server');

const router = express.Router();
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const publicHost = env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL).host : null;
const allowedOrigins = new Set(env.MCP_ALLOWED_ORIGINS.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean));
// base64 grows the payload by 4/3; leave room for the JSON-RPC envelope
const jsonLimit = `${Math.ceil(env.MCP_MAX_INLINE_MB * 1.4) + 1}mb`;

const rpcError = (res, status, message) => res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

/** Caller is on this machine: loopback socket, not through the tunnel (cloudflared also connects from loopback) or a proxy. */
const isLocal = (req) => LOOPBACK.has(req.socket.remoteAddress) && (!publicHost || req.headers.host !== publicHost) && !req.headers['x-forwarded-for'];

router.use((req, res, next) => {
  if (!env.MCP_ENABLED) return res.status(404).json({ ok: false, error: 'The MCP server is disabled (MCP_ENABLED=false)' });
  // DNS-rebinding guard (MCP spec): native clients send no Origin; browsers must be explicitly allowed.
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin.replace(/\/$/, ''))) return rpcError(res, 403, `Origin ${origin} is not allowed (MCP_ALLOWED_ORIGINS)`);
  next();
});

// Stateless: no server-initiated stream and no sessions to end.
router.get('/', (req, res) => res.set('Allow', 'POST').status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST.' }, id: null }));
router.delete('/', (req, res) => res.set('Allow', 'POST').status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server, no sessions).' }, id: null }));

router.post('/',
  (req, res, next) => { res.set('WWW-Authenticate', 'Bearer realm="social-automations"'); next(); },
  apiAuth,
  (req, res, next) => { res.removeHeader('WWW-Authenticate'); next(); },
  express.json({ limit: jsonLimit }),
  async (req, res) => {
    const ua = req.get('user-agent');
    const msgs = Array.isArray(req.body) ? req.body : [req.body];
    for (const m of msgs) {
      if (m && m.method === 'initialize') guard.rememberClient(req.project.id, ua, m.params && m.params.clientInfo);
    }
    const ctx = { project: req.project, client: guard.clientName(req.project.id, ua), local: isLocal(req) };
    const server = buildMcpServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('MCP request failed:', e);
      if (!res.headersSent) rpcError(res, 500, 'Internal server error');
    }
  });

// body too large / bad JSON: answer in JSON-RPC shape
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return rpcError(res, 413, `Request too large (max ${jsonLimit}). Use upload_media_from_url for big files.`);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  console.error('MCP error:', err);
  rpcError(res, 500, 'Internal server error');
});

module.exports = router;
