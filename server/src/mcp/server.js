'use strict';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { toolFactory } = require('./tool');

const VERSION = require('../../package.json').version;

const INSTRUCTIONS = `This server posts to the social accounts (LinkedIn, YouTube, Facebook, Instagram) connected to ONE project of the user's Social Automations app.
- Call get_project first: only target platforms that are connected. The project's caption footer and hashtags are appended to every caption automatically, so don't repeat them.
- Upload media first (upload_media_from_url for videos / large files, upload_media_base64 for small images) and pass the returned ids as mediaIds. A media id can be used in one post only.
- YouTube needs a video and a title. Instagram has no text-only posts. contentType "reel" = vertical short video.
- Scheduled times need an ISO 8601 UTC offset, e.g. 2026-11-25T09:00:00+05:00.
- create_post publishes PUBLICLY. Always run validate_post first, show the user the final text, platforms and time, and get explicit confirmation before calling create_post. Same for delete_post.
- create_post returns at once; use wait_for_post to report the live URLs or errors.`;

/**
 * One MCP server per request (stateless mode), bound to the project of the API key.
 * ctx = { project, client, local }
 */
function buildMcpServer(ctx) {
  const server = new McpServer({ name: 'social-automations', title: 'Social Automations', version: VERSION }, { instructions: INSTRUCTIONS });
  const define = toolFactory(server, ctx);
  require('./tools/project')(define, ctx);
  require('./tools/media')(define, ctx);
  require('./tools/posts')(define, ctx);
  require('./resources')(server, ctx);
  require('./prompts')(server, ctx);
  return server;
}

/** In-process listing (no HTTP, no key) for the app's Integration page: tools, resources, prompts. */
async function describe(ctx) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const server = buildMcpServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'social-automations-ui', version: VERSION });
  await server.connect(a);
  await client.connect(b);
  try {
    const [{ tools }, { resources }, { resourceTemplates }, { prompts }] = await Promise.all([
      client.listTools(), client.listResources(), client.listResourceTemplates(), client.listPrompts(),
    ]);
    return {
      tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, annotations: t.annotations || {} })),
      resources: [...resources.filter((r) => !r.uri.startsWith('social://posts/')).map((r) => r.uri), ...resourceTemplates.map((r) => r.uriTemplate)],
      prompts: prompts.map((p) => ({ name: p.name, title: p.title, description: p.description })),
    };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

module.exports = { buildMcpServer, describe, INSTRUCTIONS };
