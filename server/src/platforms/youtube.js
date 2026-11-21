'use strict';
const fs = require('fs');
const { google } = require('googleapis');
const env = require('../config/env');
const { googleClient } = require('../services/tokens');
const { PublishError, fromHttp } = require('../services/errors');
const { textOf, videoOf, absPath } = require('./base');

function tagsOf(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

async function publish(ctx) {
  const acc = ctx.account;
  const { caption, title, overrides } = textOf(ctx);
  const video = videoOf(ctx);
  if (!video) throw new PublishError('YouTube needs a video');
  let description = caption;
  if (ctx.post.content_type === 'reel' && !/#shorts/i.test(`${title} ${description}`)) {
    description = `${description}\n\n#Shorts`.trim();
  }
  // Until the API audit passes, uploads from unaudited projects are locked to private.
  const wanted = ['public', 'unlisted', 'private'].includes(overrides.privacy) ? overrides.privacy : 'private';
  const privacy = env.YOUTUBE_AUDITED ? wanted : 'private';
  if (privacy !== wanted) ctx.log('warn', `YouTube audit not passed: uploading as private instead of ${wanted}`);

  const auth = googleClient(acc);
  const yt = google.youtube({ version: 'v3', auth });
  const size = Number(video.size_bytes);
  const upload = () => yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title, description, tags: tagsOf(overrides.tags), categoryId: String(overrides.categoryId || '22') },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(absPath(video)) },
  }, {
    onUploadProgress: (evt) => ctx.setProgress(Math.min(98, Math.round((evt.bytesRead / size) * 98))),
    maxBodyLength: Infinity,
  });
  try {
    // Refresh an expired access token up front rather than mid-upload (a stale token made
    // Google answer "Could not determine client ID from request").
    await auth.getAccessToken();
    let data;
    try {
      ({ data } = await upload());
    } catch (e) {
      if (!/could not determine client id/i.test(e.message || '')) throw e;
      ctx.log('warn', 'YouTube rejected the upload credentials; refreshing the token and retrying once');
      auth.credentials.expiry_date = 1; // force a refresh
      await auth.getAccessToken();
      ({ data } = await upload());
    }
    const url = ctx.post.content_type === 'reel' ? `https://www.youtube.com/shorts/${data.id}` : `https://www.youtube.com/watch?v=${data.id}`;
    return { externalId: data.id, url };
  } catch (e) {
    const reason = e.errors && e.errors[0] && e.errors[0].reason;
    if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') {
      throw new PublishError('YouTube daily quota exceeded. Try again tomorrow (retry manually).', { raw: e.errors });
    }
    if (e.message === 'invalid_grant' || (e.response && e.response.data && e.response.data.error === 'invalid_grant')) {
      throw new PublishError('YouTube access was revoked. Reconnect the account.', { reconnect: true });
    }
    throw fromHttp(e, 'YouTube: ');
  }
}

async function remove({ target, account }) {
  const yt = google.youtube({ version: 'v3', auth: googleClient(account) });
  await yt.videos.delete({ id: target.external_id });
}

module.exports = { name: 'youtube', publish, remove };
