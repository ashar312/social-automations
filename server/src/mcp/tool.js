'use strict';
const env = require('../config/env');
const guard = require('./guard');
const format = require('./format');

/** Tool error result (not a protocol error), so the model can read it and fix its input. */
const errorResult = (text) => ({ content: [{ type: 'text', text }], isError: true });

/**
 * Returns define(name, config, fn) that registers a tool on `server` with rate limiting, audit logging and
 * error mapping. `fn(args, extra)` returns { text, data, postId? }: text for the model, data as structuredContent.
 */
function toolFactory(server, ctx) {
  return function define(name, config, fn) {
    server.registerTool(name, config, async (args, extra) => {
      if (!guard.calls.allow(ctx.project.id)) {
        return errorResult(`Rate limit reached (${env.MCP_RATE_PER_MIN} tool calls per minute for this project). Wait a minute and try again.`);
      }
      try {
        const { text, data, postId = null } = await fn(args || {}, extra);
        guard.audit({ project: ctx.project, client: ctx.client, tool: name, ok: true, postId });
        return { content: [{ type: 'text', text }], structuredContent: data };
      } catch (e) {
        const known = e.status && e.status < 500;
        if (!known) console.error(`MCP tool ${name} failed:`, e);
        const msg = known ? e.message : 'Internal server error (see the server log)';
        guard.audit({ project: ctx.project, client: ctx.client, tool: name, ok: false, postId: (args && args.id) || null, error: msg });
        return errorResult(e.results ? `${msg}\n${format.validation(e.results)}` : msg);
      }
    });
  };
}

module.exports = { toolFactory, errorResult };
