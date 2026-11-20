'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { z } = require('zod');

const opt = z.string().default('');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(5000),
  HOST: z.string().default('127.0.0.1'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  SERVER_URL: z.string().url().default('http://localhost:5000'),
  PUBLIC_BASE_URL: opt,
  // "true" = the external API (/api/v1) is also reachable through the PUBLIC_BASE_URL tunnel (for cloud tools)
  API_OVER_TUNNEL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes as hex (64 chars)'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(4096),
  DOC_MAX_MB: z.coerce.number().positive().default(100), // PDF carousels (LinkedIn limit is 100 MB)
  MEDIA_RETENTION_DAYS: z.coerce.number().default(7),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  LINKEDIN_CLIENT_ID: opt,
  LINKEDIN_CLIENT_SECRET: opt,
  LINKEDIN_REDIRECT_URI: z.string().default('http://localhost:5000/api/oauth/linkedin/callback'),
  LINKEDIN_API_VERSION: z.string().default('202611'),
  // Set to "true" once your LinkedIn app has the Community Management API product (needed to post as a Company Page)
  LINKEDIN_ORG_POSTING: z.string().default('false'),
  GOOGLE_CLIENT_ID: opt,
  GOOGLE_CLIENT_SECRET: opt,
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:5000/api/oauth/youtube/callback'),
  YOUTUBE_AUDITED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  META_APP_ID: opt,
  META_APP_SECRET: opt,
  META_REDIRECT_URI: z.string().default('http://localhost:5000/api/oauth/meta/callback'),
  META_GRAPH_VERSION: z.string().default('v24.0'),
  META_WEBHOOK_VERIFY_TOKEN: opt,
  MYSQLDUMP_PATH: opt,
  // MCP server at /api/v1/mcp (plans/05-mcp-server.md)
  MCP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  MCP_ALLOWED_ORIGINS: opt, // comma list of browser origins; empty = reject requests that send an Origin
  MCP_MAX_INLINE_MB: z.coerce.number().positive().default(10),
  MCP_ALLOWED_DIRS: opt, // comma/semicolon list of folders upload_media_from_path may read; empty = tool off
  MCP_RATE_PER_MIN: z.coerce.number().int().positive().default(60),
  MCP_POSTS_PER_HOUR: z.coerce.number().int().positive().default(20),
  // Local HTTPS (plans/06-local-https.md). Both empty = plain HTTP. Paths relative to server/.
  TLS_CERT_FILE: opt,
  TLS_KEY_FILE: opt,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const i of parsed.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
const env = parsed.data;
const path = require('path');
const fs = require('fs');
const SERVER_ROOT = path.resolve(__dirname, '../..');
env.UPLOAD_ROOT = path.resolve(SERVER_ROOT, env.UPLOAD_DIR);

// ── Local HTTPS ──
const cert = env.TLS_CERT_FILE.trim();
const key = env.TLS_KEY_FILE.trim();
if (!!cert !== !!key) {
  console.error('Invalid environment configuration:');
  console.error('  TLS_CERT_FILE and TLS_KEY_FILE must both be set (HTTPS) or both be empty (HTTP). See plans/06-local-https.md');
  process.exit(1);
}
env.HTTPS = !!(cert && key);
if (env.HTTPS) {
  env.TLS_CERT_PATH = path.resolve(SERVER_ROOT, cert);
  env.TLS_KEY_PATH = path.resolve(SERVER_ROOT, key);
  const missing = [['TLS_CERT_FILE', env.TLS_CERT_PATH], ['TLS_KEY_FILE', env.TLS_KEY_PATH]].filter(([, p]) => !fs.existsSync(p));
  if (missing.length) {
    console.error('Invalid environment configuration:');
    for (const [k, p] of missing) console.error(`  ${k}: file not found: ${p}`);
    console.error('  Create it with mkcert (plans/06-local-https.md, step 1), or clear both TLS_* values to run over HTTP.');
    process.exit(1);
  }
  const httpUrls = ['SERVER_URL', 'CLIENT_URL', 'LINKEDIN_REDIRECT_URI', 'GOOGLE_REDIRECT_URI', 'META_REDIRECT_URI']
    .filter((k) => /^http:\/\//i.test(env[k]));
  if (httpUrls.length) {
    console.warn(`[env] HTTPS is on, but these still start with http:// — update them to https:// in server/.env: ${httpUrls.join(', ')}`);
  }
}
env.SCHEME = env.HTTPS ? 'https' : 'http';
module.exports = env;
