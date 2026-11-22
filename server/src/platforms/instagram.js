'use strict';
const axios = require('axios');
const fs = require('fs');
const { GRAPH } = require('../services/tokens');
const { fromHttp, PublishError } = require('../services/errors');
const { textOf, videoOf, imagesOf, absPath, publicUrl, sleep } = require('./base');

const post = (url, acc, params) =>
  axios.post(url, new URLSearchParams({ access_token: acc.accessToken, ...params })).then((r) => r.data);

async function waitForContainer(ctx, acc, id) {
  await ctx.setStatus('processing');
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const { data } = await axios.get(`${GRAPH()}/${id}`, { params: { access_token: acc.accessToken, fields: 'status_code,status' } });
    ctx.log('info', `Instagram container status: ${data.status_code}`, data);
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new PublishError(`Instagram could not process the media (${data.status || data.status_code})`, { raw: data });
    }
    await sleep(7000);
  }
  throw new PublishError('Timed out waiting for Instagram to process the media', { retryable: true });
}

async function checkQuota(ctx, acc) {
  try {
    const { data } = await axios.get(`${GRAPH()}/${acc.externalId}/content_publishing_limit`, {
      params: { access_token: acc.accessToken, fields: 'quota_usage,config' },
    });
    const d = data.data && data.data[0];
    if (d && d.config && d.quota_usage >= d.config.quota_total) {
      throw new PublishError(`Instagram publishing limit reached (${d.quota_usage}/${d.config.quota_total} in 24h)`);
    }
  } catch (e) {
    if (e instanceof PublishError) throw e;
    ctx.log('warn', 'Could not check Instagram publishing quota');
  }
}

async function resumableVideo(ctx, acc, mf, params) {
  const size = Number(mf.size_bytes);
  const c = await post(`${GRAPH()}/${acc.externalId}/media`, acc, { ...params, media_type: 'REELS', upload_type: 'resumable' });
  await axios.post(c.uri, fs.createReadStream(absPath(mf)), {
    headers: { Authorization: `OAuth ${acc.accessToken}`, offset: '0', file_size: String(size), 'Content-Type': 'application/octet-stream', 'Content-Length': size },
    // maxRedirects: 0 bypasses follow-redirects, which buffers the whole body in memory and fires all
    // progress events up front, so the stall watchdog saw no activity during the real (slow) upload.
    maxBodyLength: Infinity, maxContentLength: Infinity, maxRedirects: 0, signal: ctx.signal, onUploadProgress: () => ctx.touch(),
  });
  return c.id;
}

async function publish(ctx) {
  const acc = ctx.account;
  const { caption, overrides } = textOf(ctx);
  const ig = acc.externalId;
  try {
    await checkQuota(ctx, acc);
    const video = videoOf(ctx);
    const images = imagesOf(ctx);
    let creation;

    if (video) {
      const params = { caption, share_to_feed: overrides.shareToFeed === false ? 'false' : 'true' };
      const url = publicUrl(video);
      ctx.log('info', url ? 'Creating Reel container (public URL)' : 'Uploading Reel (resumable)');
      creation = url
        ? (await post(`${GRAPH()}/${ig}/media`, acc, { ...params, media_type: 'REELS', video_url: url })).id
        : await resumableVideo(ctx, acc, video, params);
      ctx.setProgress(40);
      await waitForContainer(ctx, acc, creation);
    } else if (images.length === 1) {
      const url = publicUrl(images[0]);
      if (!url) throw new PublishError('PUBLIC_BASE_URL is not set: Instagram needs a public URL for images');
      creation = (await post(`${GRAPH()}/${ig}/media`, acc, { image_url: url, caption })).id;
    } else {
      const kids = [];
      for (const im of images) {
        const url = publicUrl(im);
        if (!url) throw new PublishError('PUBLIC_BASE_URL is not set: Instagram needs a public URL for images');
        kids.push((await post(`${GRAPH()}/${ig}/media`, acc, { image_url: url, is_carousel_item: 'true' })).id);
      }
      creation = (await post(`${GRAPH()}/${ig}/media`, acc, { media_type: 'CAROUSEL', children: kids.join(','), caption })).id;
      await waitForContainer(ctx, acc, creation);
    }

    ctx.setProgress(85);
    const pub = await post(`${GRAPH()}/${ig}/media_publish`, acc, { creation_id: creation });
    let url = null;
    try {
      const { data } = await axios.get(`${GRAPH()}/${pub.id}`, { params: { access_token: acc.accessToken, fields: 'permalink' } });
      url = data.permalink;
    } catch { ctx.log('warn', 'Published, but could not fetch the permalink'); }
    return { externalId: pub.id, url };
  } catch (e) { throw fromHttp(e, 'Instagram: '); }
}

// Instagram has no delete endpoint in the API.
module.exports = { name: 'instagram', publish };
