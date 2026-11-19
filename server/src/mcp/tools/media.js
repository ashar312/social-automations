'use strict';
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const env = require('../../config/env');
const mediaSvc = require('../../services/media');
const format = require('../format');

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const mediaOut = z.looseObject({ id: z.number(), kind: z.string(), suggestedType: z.string() });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** MCP_ALLOWED_DIRS as resolved real paths (missing folders are ignored). */
function allowedDirs() {
  return env.MCP_ALLOWED_DIRS.split(/[,;]/).map((s) => s.trim()).filter(Boolean).flatMap((d) => {
    try { return [fs.realpathSync(path.resolve(d))]; } catch { return []; }
  });
}

/** Real path of `p` if it is inside one of the allowed dirs (symlinks resolved), else throws. */
function resolveAllowed(p, dirs) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw bad('path must be an absolute path');
  let real;
  try { real = fs.realpathSync(p); } catch { throw bad(`File not found: ${p}`); }
  const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const inside = dirs.some((d) => {
    const rel = path.relative(norm(d), norm(real));
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!inside) throw bad(`Not allowed: ${p} is outside the folders in MCP_ALLOWED_DIRS (${dirs.join(', ')})`);
  return real;
}

module.exports = function register(define, ctx) {
  const opts = { projectId: ctx.project.id };

  define('upload_media_from_url', {
    title: 'Upload media from URL',
    description: 'The server downloads a public http(s) image or video (jpg, png, webp, mp4, mov) and stores it for this project. '
      + 'Returns a media id for create_post. Best for large videos. Private/local network URLs are refused.',
    inputSchema: {
      url: z.string().url().describe('Public http(s) URL of the file'),
      name: z.string().max(200).optional().describe('File name to store, e.g. "launch.mp4" (helps when the URL has no extension)'),
    },
    annotations: { ...WRITE, openWorldHint: true },
    outputSchema: mediaOut,
  }, async ({ url, name }) => {
    const m = await mediaSvc.importFromUrl(url, name, opts);
    return { text: format.media(m), data: m };
  });

  define('upload_media_base64', {
    title: 'Upload media (base64)',
    description: `Upload a small file sent inline as base64 (max ${env.MCP_MAX_INLINE_MB} MB), e.g. an image you generated or the user pasted. `
      + 'For videos or big files use upload_media_from_url. Returns a media id for create_post.',
    inputSchema: {
      filename: z.string().min(1).max(200).describe('e.g. "cover.png"'),
      data: z.string().min(1).describe('File contents, base64 encoded (no data: prefix needed)'),
      mimeType: z.string().optional().describe('e.g. "image/png"; used when the filename has no known extension'),
    },
    annotations: { ...WRITE, openWorldHint: false },
    outputSchema: mediaOut,
  }, async ({ filename, data, mimeType }) => {
    const b64 = data.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > env.MCP_MAX_INLINE_MB * 1024 * 1024) throw bad(`File is larger than ${env.MCP_MAX_INLINE_MB} MB. Use upload_media_from_url instead.`);
    const m = await mediaSvc.importBuffer(buf, filename, mimeType, opts);
    return { text: format.media(m), data: m };
  });

  // Local files: only when folders are allowed AND the caller is on this machine (not via LAN or the tunnel).
  const dirs = allowedDirs();
  if (dirs.length && ctx.local) {
    define('upload_media_from_path', {
      title: 'Upload media from a local file',
      description: `Copy a local image or video file on this computer into the project (e.g. a video you just rendered). Allowed folders: ${dirs.join(', ')}. Returns a media id for create_post.`,
      inputSchema: { path: z.string().min(1).describe('Absolute path of the file, inside an allowed folder') },
      annotations: { ...WRITE, openWorldHint: false },
      outputSchema: mediaOut,
    }, async ({ path: p }) => {
      const m = await mediaSvc.importLocalFile(resolveAllowed(p, dirs), opts);
      return { text: format.media(m), data: m };
    });
  }
};

module.exports.resolveAllowed = resolveAllowed;
