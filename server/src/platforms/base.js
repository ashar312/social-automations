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

/**
 * Stream a file as the raw body of a Meta rupload POST.
 * Plain https.request + pipe instead of axios: axios's follow-redirects path buffers the whole body and
 * fires all progress up front (blinding the stall watchdog), and its maxRedirects:0 + onUploadProgress
 * path gets rejected by rupload with 400 ProcessingFailedError. pipe() respects backpressure, so each
 * 'data' event here means bytes actually went to the socket.
 * Errors mimic axios ({ response: { status, data } }) so fromHttp() handles them unchanged.
 */
function ruploadOnce(ctx, url, file, headers, size, start) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { ...headers, offset: String(start), file_size: String(size), 'Content-Type': 'application/octet-stream', 'Content-Length': size - start },
      signal: ctx.signal,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let data = body;
        try { data = JSON.parse(body); } catch { /* keep text */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
        const err = new Error(`Request failed with status code ${res.statusCode}`);
        err.response = { status: res.statusCode, data };
        reject(err);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    const stream = fs.createReadStream(file, { start });
    stream.on('data', () => ctx.touch());
    stream.on('error', (e) => { req.destroy(e); reject(e); });
    stream.pipe(req);
  });
}

/** Bytes the rupload session already holds (GET on the same URL answers { offset }); 0 if unknown. */
async function ruploadOffset(url, headers) {
  try {
    const { data } = await require('axios').get(url, { headers: { Authorization: headers.Authorization } });
    const n = Number(data && data.offset);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

// rupload sometimes drops a good upload with 400 ProcessingFailedError (debug_info says retriable:false, but
// re-sending into the same session succeeds), and connections can reset. Those get resumed; anything else is final.
function ruploadRetriable(e) {
  if (e.name === 'AbortError') return false;
  const r = e.response;
  if (!r) return true; // network error
  if (r.status >= 500) return true;
  return r.status === 400 && r.data && r.data.debug_info && r.data.debug_info.type === 'ProcessingFailedError';
}

/**
 * Upload a file to a Meta rupload session, resuming from the offset Meta reports if an attempt is dropped.
 */
async function ruploadFile(ctx, url, file, headers, { attempts = 5 } = {}) {
  const size = fs.statSync(file).size;
  let start = 0;
  for (let i = 1; ; i++) {
    try {
      return await ruploadOnce(ctx, url, file, headers, size, start);
    } catch (e) {
      if (ctx.signal.aborted || i >= attempts || !ruploadRetriable(e)) throw e;
      const why = e.response ? `HTTP ${e.response.status} ${e.response.data?.debug_info?.type || ''}`.trim() : e.message;
      if (ctx.log) ctx.log('warn', `Upload attempt ${i}/${attempts} was dropped by Meta (${why}); retrying`, e.response?.data);
      await sleep(2000 * i);
      start = await ruploadOffset(url, headers);
      if (start >= size) return { success: true, resumed: true };
    }
  }
}

module.exports = { textOf, videoOf, imagesOf, documentOf, absPath, publicUrl, readRange, sleep, ruploadFile };
