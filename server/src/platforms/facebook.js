'use strict';
const axios = require('axios');
const fs = require('fs');
const { GRAPH } = require('../services/tokens');
const env = require('../config/env');
const { fromHttp, PublishError } = require('../services/errors');
const { textOf, videoOf, imagesOf, absPath, readRange, sleep } = require('./base');

const VIDEO_GRAPH = () => `https://graph-video.facebook.com/${env.META_GRAPH_VERSION}`;
const RUPLOAD = () => `https://rupload.facebook.com/video-upload/${env.META_GRAPH_VERSION}`;
const CHUNK = 8 * 1024 * 1024;

function form(obj) {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) if (v != null) f.append(k, v);
  return f;
}

async function photo(ctx, acc, mf, extra) {
  const buf = await fs.promises.readFile(absPath(mf));
  const f = form({ access_token: acc.accessToken, ...extra });
  f.append('source', new Blob([buf], { type: mf.mime_type }), mf.original_name);
  const { data } = await axios.post(`${GRAPH()}/${acc.externalId}/photos`, f, { maxBodyLength: Infinity });
  return data;
}

async function chunkedVideo(ctx, acc, mf, caption, title) {
  const size = Number(mf.size_bytes);
  const file = absPath(mf);
  const base = `${VIDEO_GRAPH()}/${acc.externalId}/videos`;
  const { data: s } = await axios.post(base, form({ access_token: acc.accessToken, upload_phase: 'start', file_size: String(size) }));
  let { start_offset: start, end_offset: end } = s;
  while (Number(start) < size) {
    const buf = await readRange(file, Number(start), Number(end));
    const f = form({ access_token: acc.accessToken, upload_phase: 'transfer', upload_session_id: s.upload_session_id, start_offset: String(start) });
    f.append('video_file_chunk', new Blob([buf]), 'chunk');
    const { data } = await axios.post(base, f, { maxBodyLength: Infinity, signal: ctx.signal });
    start = data.start_offset; end = data.end_offset;
    ctx.setProgress(Math.min(95, Math.round((Number(start) / size) * 95)));
  }
  await axios.post(base, form({
    access_token: acc.accessToken, upload_phase: 'finish', upload_session_id: s.upload_session_id,
    description: caption, title: title || undefined,
  }));
  return s.video_id;
}

async function reel(ctx, acc, mf, caption) {
  const size = Number(mf.size_bytes);
  const base = `${GRAPH()}/${acc.externalId}/video_reels`;
  const { data: s } = await axios.post(base, form({ access_token: acc.accessToken, upload_phase: 'start' }));
  const videoId = s.video_id;
  await axios.post(s.upload_url || `${RUPLOAD()}/${videoId}`, fs.createReadStream(absPath(mf)), {
    headers: { Authorization: `OAuth ${acc.accessToken}`, offset: '0', file_size: String(size), 'Content-Type': 'application/octet-stream', 'Content-Length': size },
    // maxRedirects: 0 bypasses follow-redirects, which buffers the whole body in memory and fires all
    // progress events up front, so the stall watchdog saw no activity during the real (slow) upload.
    maxBodyLength: Infinity, maxContentLength: Infinity, maxRedirects: 0, signal: ctx.signal, onUploadProgress: () => ctx.touch(),
  });
  ctx.setProgress(80);
  await axios.post(base, form({
    access_token: acc.accessToken, upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: caption,
  }));
  await ctx.setStatus('processing');
  for (let i = 0; i < 90; i++) {
    const { data } = await axios.get(`${GRAPH()}/${videoId}`, { params: { access_token: acc.accessToken, fields: 'status' } });
    const st = data.status || {};
    ctx.log('info', `Facebook reel status: ${st.video_status}`, st);
    if (st.video_status === 'ready' || st.publishing_phase?.status === 'complete') return videoId;
    if (st.video_status === 'error') throw new PublishError('Facebook failed to process the reel', { raw: st });
    await sleep(6000);
  }
  throw new PublishError('Timed out waiting for Facebook to process the reel', { retryable: true });
}

async function publish(ctx) {
  const acc = ctx.account;
  const { caption, title } = textOf(ctx);
  const pageId = acc.externalId;
  try {
    const video = videoOf(ctx);
    const images = imagesOf(ctx);
    if (video) {
      if (ctx.post.content_type === 'reel') {
        ctx.log('info', 'Uploading Reel to Facebook');
        const id = await reel(ctx, acc, video, caption);
        return { externalId: id, url: `https://www.facebook.com/reel/${id}` };
      }
      ctx.log('info', 'Uploading video to Facebook');
      const id = await chunkedVideo(ctx, acc, video, caption, title);
      return { externalId: id, url: `https://www.facebook.com/${id}` };
    }
    if (images.length === 1) {
      const d = await photo(ctx, acc, images[0], { caption });
      const id = d.post_id || d.id;
      return { externalId: id, url: `https://www.facebook.com/${id}` };
    }
    if (images.length > 1) {
      const ids = [];
      for (const im of images) ids.push((await photo(ctx, acc, im, { published: 'false' })).id);
      const f = { access_token: acc.accessToken, message: caption };
      ids.forEach((id, i) => { f[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
      const { data } = await axios.post(`${GRAPH()}/${pageId}/feed`, form(f));
      return { externalId: data.id, url: `https://www.facebook.com/${data.id}` };
    }
    const { data } = await axios.post(`${GRAPH()}/${pageId}/feed`, form({ access_token: acc.accessToken, message: caption }));
    return { externalId: data.id, url: `https://www.facebook.com/${data.id}` };
  } catch (e) { throw fromHttp(e, 'Facebook: '); }
}

async function remove({ target, account }) {
  await axios.delete(`${GRAPH()}/${target.external_id}`, { params: { access_token: account.accessToken } });
}

module.exports = { name: 'facebook', publish, remove };
