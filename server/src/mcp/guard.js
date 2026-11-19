'use strict';
/** Per-key rate limits, client names and the audit log for MCP tool calls. In memory: fine for a single-process app. */
const env = require('../config/env');
const { ActivityLog } = require('../db/models');

/** Sliding-window counter: allow(key) is true while fewer than `max` hits happened in the last `windowMs`. */
function limiter(max, windowMs) {
  const hits = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= max) { hits.set(key, list); return false; }
      list.push(now);
      hits.set(key, list);
      return true;
    },
  };
}
const calls = limiter(env.MCP_RATE_PER_MIN, 60_000);
const posts = limiter(env.MCP_POSTS_PER_HOUR, 3_600_000);

/**
 * Stateless mode builds a new server per request, so the clientInfo sent in `initialize` isn't known on later
 * tool calls. Remember it per project + User-Agent; fall back to the User-Agent's product token.
 */
const clients = new Map();
const clientKey = (projectId, ua) => `${projectId}|${ua || ''}`;
function rememberClient(projectId, ua, clientInfo) {
  if (!clientInfo || typeof clientInfo.name !== 'string') return;
  if (clients.size > 500) clients.clear();
  clients.set(clientKey(projectId, ua), String(clientInfo.name).slice(0, 48));
}
function clientName(projectId, ua) {
  return clients.get(clientKey(projectId, ua)) || (ua ? String(ua).split(/[\s/]/)[0].slice(0, 48) : 'unknown');
}

/** One activity_logs row per tool call (post_target_id is NULL; data.via = "mcp"). Never throws. */
async function audit({ project, client, tool, ok, postId = null, error = null }) {
  try {
    await ActivityLog.create({
      post_target_id: null, level: ok ? 'info' : 'warn',
      message: `MCP ${tool} via ${client}${postId ? ` (post #${postId})` : ''}${ok ? '' : `: ${String(error).slice(0, 300)}`}`.slice(0, 1024),
      data: { via: 'mcp', tool, client, projectId: project.id, postId, ok },
    });
  } catch (e) { console.warn(`MCP audit log failed: ${e.message}`); }
}

module.exports = { calls, posts, rememberClient, clientName, audit };
