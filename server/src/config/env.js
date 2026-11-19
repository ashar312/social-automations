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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const i of parsed.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
const env = parsed.data;
env.UPLOAD_ROOT = require('path').resolve(__dirname, '../..', env.UPLOAD_DIR);
module.exports = env;
