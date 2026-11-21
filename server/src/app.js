'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { loadUser, requireUser, checkOrigin } = require('./middleware/auth');
const { router: mediaRouter, publicRouter } = require('./routes/media');

const app = express();

const isApi = (p) => p === '/api/v1' || p.startsWith('/api/v1/');

// Requests that arrive through the public tunnel (Host = PUBLIC_BASE_URL host) may only reach /media/*
// (and /api/v1/* when API_OVER_TUNNEL=true).
if (env.PUBLIC_BASE_URL) {
  const publicHost = new URL(env.PUBLIC_BASE_URL).host;
  app.use((req, res, next) => {
    if (req.headers.host === publicHost && !req.path.startsWith('/media/') && !(env.API_OVER_TUNNEL && isApi(req.path))) return res.status(404).end();
    next();
  });
}
// UI routes are behind login now; by default they are still loopback-only (UI_REMOTE_ACCESS=true lifts that). When HOST exposes the server to the network, only the
// key-protected external API (/api/v1) and public media are reachable from other machines.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
app.use((req, res, next) => {
  if (env.UI_REMOTE_ACCESS || LOOPBACK.has(req.socket.remoteAddress) || isApi(req.path) || req.path.startsWith('/media/')) return next();
  res.status(404).end();
});
app.use('/media', publicRouter);

app.use(morgan('dev'));
// MCP server (before the global JSON parser: it has its own, larger limit for base64 uploads)
app.use('/api/v1/mcp', cors({ exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'] }), require('./mcp'));
app.use(express.json({ limit: '1mb' }));

// External API: any origin (auth is the per-project API key, no cookies)
app.use('/api/v1', cors(), require('./routes/v1'));

app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.use('/api', loadUser, checkOrigin);
app.use('/api/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
// Signed links from emails (unsubscribe, feedback): the token is the credential
app.use('/api/email', require('./routes/email'));
if (env.NODE_ENV !== 'production') app.use('/api/dev/emails', requireUser, require('./routes/devEmails'));
// OAuth callbacks are browser redirects from the provider; routes/oauth.js applies requireUser itself on start/picker endpoints.
app.use('/api/oauth', require('./routes/oauth'));
app.use('/api/account', requireUser, require('./routes/account'));
app.use('/api/projects', requireUser, require('./routes/projects'));
app.use('/api/connections', requireUser, require('./routes/connections').global);
app.use('/api/media', requireUser, mediaRouter);
app.use('/api/posts', requireUser, require('./routes/posts'));
app.get('/api/config', requireUser, (req, res) => res.json({
  ok: true, youtubeAudited: env.YOUTUBE_AUDITED, publicUrlConfigured: !!env.PUBLIC_BASE_URL, rules: require('./platforms/rules').RULES,
  api: {
    localBase: `${env.SERVER_URL.replace(/\/$/, '')}/api/v1`,
    tunnelBase: env.API_OVER_TUNNEL && env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/v1` : null,
    host: env.HOST,
    https: env.HTTPS,
    mcpEnabled: env.MCP_ENABLED,
    mcpLocal: `${env.SERVER_URL.replace(/\/$/, '')}/api/v1/mcp`,
    mcpTunnel: env.API_OVER_TUNNEL && env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/v1/mcp` : null,
    mcpBridge: require('path').resolve(__dirname, '../bin/mcp-stdio.js').split(require('path').sep).join('/'),
    mcpLocalFiles: !!env.MCP_ALLOWED_DIRS.trim(),
  },
}));

app.use(notFound);
app.use(errorHandler);
module.exports = app;
