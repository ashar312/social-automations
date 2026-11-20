'use strict';
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const m = require('../services/media');

/** Effective text/title for a target (override wins over the post default). */
function textOf(ctx) {
  const o = ctx.target.overrides || {};
  return {
    caption: o.caption != null ? String(o.caption) : ctx.post.caption || '',
    title: o.title != null ? String(o.title) : ctx.post.title || '',
    overrides: o,
  };
}

const videoOf = (ctx) => ctx.media.find((x) => x.kind === 'video');
const imagesOf = (ctx) => ctx.media.filter((x) => x.kind === 'image');
const documentOf = (ctx) => ctx.media.find((x) => x.kind === 'document');
const absPath = (mf) => m.abs(mf.stored_path);

function publicUrl(mf) {
  if (!env.PUBLIC_BASE_URL) return null;
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/media/${mf.public_token}/${encodeURIComponent(path.basename(mf.stored_path))}`;
}

/** Read a byte range of a file into a Buffer. */
async function readRange(file, start, endExclusive) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const len = endExclusive - start;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    return buf;
  } finally { await fh.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { textOf, videoOf, imagesOf, documentOf, absPath, publicUrl, readRange, sleep };
