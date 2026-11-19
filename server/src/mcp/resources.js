'use strict';
/** MCP resources: read-only context a client can attach (plans/05-mcp-server.md 1.2). */
const fs = require('fs');
const { ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { RULES, SUPPORTED } = require('../platforms/rules');
const { projectView } = require('../services/projects');
const svc = require('../services/posts');
const mediaSvc = require('../services/media');
const { MediaFile, Post } = require('../db/models');

const json = (uri, data) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] });
const notFound = (what) => Object.assign(new Error(`${what} not found in this project`), { status: 404 });

module.exports = function register(server, ctx) {
  const { project } = ctx;

  server.registerResource('project', 'social://project', {
    title: 'Project', description: 'This project: settings and connected platforms (same as get_project)', mimeType: 'application/json',
  }, async (uri) => json(uri, await projectView(project)));

  server.registerResource('rules', 'social://rules', {
    title: 'Platform rules', description: 'Caption/title limits, video lengths and sizes, accepted content types', mimeType: 'application/json',
  }, async (uri) => json(uri, { rules: RULES, supportedContentTypes: SUPPORTED }));

  server.registerResource('post', new ResourceTemplate('social://posts/{id}', {
    // the 20 newest posts, so clients can offer them for attaching
    list: async () => {
      const { posts } = await svc.listPosts(project, { limit: 20 });
      return { resources: posts.map((p) => ({ uri: `social://posts/${p.id}`, name: `Post #${p.id} (${p.status})`, mimeType: 'application/json' })) };
    },
  }), { title: 'Post', description: 'One post with per-platform status, links and errors', mimeType: 'application/json' }, async (uri, { id }) => {
    const p = await svc.getPost(project, id, { logLimit: 20 });
    return json(uri, { ...p, targets: p.targets.map(({ errorRaw, ...t }) => t) });
  });

  server.registerResource('media-thumb', new ResourceTemplate('social://media/{id}/thumb', { list: undefined }), {
    title: 'Media thumbnail', description: 'JPEG/PNG preview of an uploaded image or video so the model can look at it',
  }, async (uri, { id }) => {
    const m = await MediaFile.findByPk(Number(id));
    let mine = m && m.project_id === project.id;
    if (m && !mine && m.post_id) mine = !!(await Post.count({ where: { id: m.post_id, project_id: project.id } }));
    if (!mine) throw notFound('Media');
    const file = m.kind === 'image' ? mediaSvc.abs(m.stored_path) : mediaSvc.abs(mediaSvc.thumbRel(m.stored_path));
    let buf;
    try { buf = await fs.promises.readFile(file); } catch { throw notFound('Thumbnail'); }
    const mimeType = m.kind === 'image' ? m.mime_type : 'image/jpeg';
    return { contents: [{ uri: uri.href, mimeType, blob: buf.toString('base64') }] };
  });
};
