'use strict';
const axios = require('axios');
const fs = require('fs');
const env = require('../config/env');
const { fromHttp, PublishError } = require('../services/errors');
const { textOf, videoOf, imagesOf, documentOf, absPath, readRange, sleep } = require('./base');

const API = 'https://api.linkedin.com/rest';
const CHUNK = 4 * 1024 * 1024;

const headers = (acc) => ({
  Authorization: `Bearer ${acc.accessToken}`,
  'LinkedIn-Version': env.LINKEDIN_API_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
});

// LinkedIn treats these as special in "commentary" (little-text format)
const escapeCommentary = (s) => s.replace(/[\\(){}[\]<>@|~_*]/g, (c) => `\\${c}`);

async function uploadImage(ctx, acc, mf) {
  const { data } = await axios.post(`${API}/images?action=initializeUpload`,
    { initializeUploadRequest: { owner: acc.externalId } }, { headers: headers(acc) });
  const { uploadUrl, image } = data.value;
  await axios.put(uploadUrl, fs.createReadStream(absPath(mf)), {
    headers: { Authorization: `Bearer ${acc.accessToken}`, 'Content-Type': 'application/octet-stream', 'Content-Length': mf.size_bytes },
    maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  return image;
}

async function uploadVideo(ctx, acc, mf) {
  const size = Number(mf.size_bytes);
  const { data } = await axios.post(`${API}/videos?action=initializeUpload`, {
    initializeUploadRequest: { owner: acc.externalId, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false },
  }, { headers: headers(acc) });
  const { video, uploadInstructions, uploadToken } = data.value;
  const etags = [];
  const file = absPath(mf);
  for (let i = 0; i < uploadInstructions.length; i++) {
    const ins = uploadInstructions[i];
    const buf = await readRange(file, ins.firstByte, ins.lastByte + 1);
    const r = await axios.put(ins.uploadUrl, buf, {
      headers: { 'Content-Type': 'application/octet-stream' }, maxBodyLength: Infinity, maxContentLength: Infinity,
    });
    etags.push(r.headers.etag);
    ctx.setProgress(Math.round(((i + 1) / uploadInstructions.length) * 80));
  }
  await axios.post(`${API}/videos?action=finalizeUpload`, {
    finalizeUploadRequest: { video, uploadToken: uploadToken || '', uploadedPartIds: etags },
  }, { headers: headers(acc) });

  await ctx.setStatus('processing');
  for (let i = 0; i < 120; i++) {
    const { data: v } = await axios.get(`${API}/videos/${encodeURIComponent(video)}`, { headers: headers(acc) });
    ctx.log('info', `LinkedIn video status: ${v.status}`);
    if (v.status === 'AVAILABLE') return video;
    if (v.status === 'PROCESSING_FAILED') throw new PublishError('LinkedIn failed to process the video', { raw: v });
    await sleep(5000);
  }
  throw new PublishError('Timed out waiting for LinkedIn to process the video', { retryable: true });
}

/**
 * Documents API (PDF carousel): initializeUpload → one PUT of the raw bytes → poll until AVAILABLE.
 * Returns the urn:li:document:… to use as content.media.id.
 */
async function uploadDocument(ctx, acc, mf) {
  const { data } = await axios.post(`${API}/documents?action=initializeUpload`,
    { initializeUploadRequest: { owner: acc.externalId } }, { headers: headers(acc) });
  const { uploadUrl, document } = data.value;
  ctx.setProgress(10);
  await axios.put(uploadUrl, fs.createReadStream(absPath(mf)), {
    headers: { Authorization: `Bearer ${acc.accessToken}`, 'Content-Type': 'application/octet-stream', 'Content-Length': mf.size_bytes },
    maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  ctx.setProgress(60);
  await ctx.setStatus('processing');
  for (let i = 0; i < 60; i++) { // every 3 s for up to 3 min
    const { data: d } = await axios.get(`${API}/documents/${encodeURIComponent(document)}`, { headers: headers(acc) });
    ctx.log('info', `LinkedIn document status: ${d.status}`);
    if (d.status === 'AVAILABLE') { ctx.setProgress(80); return document; }
    if (d.status === 'PROCESSING_FAILED') throw new PublishError('LinkedIn failed to process the PDF', { raw: d });
    await sleep(3000);
  }
  throw new PublishError('Timed out waiting for LinkedIn to process the PDF', { retryable: true });
}

async function publish(ctx) {
  const acc = ctx.account;
  const { caption, title } = textOf(ctx);
  const body = {
    author: acc.externalId,
    commentary: escapeCommentary(caption),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  try {
    const doc = documentOf(ctx);
    const video = videoOf(ctx);
    const images = imagesOf(ctx);
    if (doc) {
      ctx.log('info', `Uploading PDF carousel to LinkedIn (${doc.page_count || '?'} pages)`);
      const urn = await uploadDocument(ctx, acc, doc);
      // title is required for documents; it is the header shown above the slides
      body.content = { media: { id: urn, title: title || doc.original_name.replace(/\.pdf$/i, '') } };
    } else if (video) {
      ctx.log('info', 'Uploading video to LinkedIn');
      const urn = await uploadVideo(ctx, acc, video);
      body.content = { media: { id: urn, title: title || video.original_name } };
    } else if (images.length) {
      ctx.log('info', `Uploading ${images.length} image(s) to LinkedIn`);
      const urns = [];
      for (const im of images) urns.push(await uploadImage(ctx, acc, im));
      body.content = urns.length === 1 ? { media: { id: urns[0] } } : { multiImage: { images: urns.map((id) => ({ id })) } };
    }
    ctx.setProgress(90);
    const res = await axios.post(`${API}/posts`, body, { headers: headers(acc) });
    const urn = res.headers['x-restli-id'];
    if (!urn) throw new PublishError('LinkedIn did not return a post id', { raw: res.data });
    return { externalId: urn, url: `https://www.linkedin.com/feed/update/${urn}` };
  } catch (e) { throw fromHttp(e, 'LinkedIn: '); }
}

async function remove({ target, account }) {
  await axios.delete(`${API}/posts/${encodeURIComponent(target.external_id)}`, { headers: headers(account) });
}

module.exports = { name: 'linkedin', publish, remove, escapeCommentary, uploadDocument, headers, API };
