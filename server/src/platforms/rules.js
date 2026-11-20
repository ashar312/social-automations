'use strict';
// Per-platform limits as data so they are easy to edit.
const RULES = {
  linkedin: {
    maxText: 3000,
    video: { minSec: 3, maxSec: 1800, maxBytes: 500 * 1024 * 1024 },
    maxImages: 20,
    // PDF carousel ("document post"): LinkedIn renders the pages as swipeable slides
    document: { maxBytes: 100 * 1024 * 1024, maxPages: 300, maxTitle: 400, recommendedPages: [5, 20] },
  },
  youtube: {
    maxTitle: 100,
    maxDescription: 5000,
    shortMaxSec: 180,
  },
  facebook: {
    reel: { minSec: 3, maxSec: 90, minWidth: 540, minHeight: 960 },
  },
  instagram: {
    maxCaption: 2200,
    maxHashtags: 30,
    reel: { minSec: 3, maxSec: 900 },
    image: { minRatio: 0.8, maxRatio: 1.91 }, // width / height (4:5 to 1.91:1)
    carousel: { min: 2, max: 10 },
  },
};

const hashtags = (s) => (String(s || '').match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;

/** Which content types each platform can take. */
const SUPPORTED = {
  linkedin: ['text', 'image', 'video', 'reel', 'document'],
  youtube: ['video', 'reel'],
  facebook: ['text', 'image', 'video', 'reel'],
  instagram: ['image', 'video', 'reel'],
};
const UNSUPPORTED_REASON = {
  youtube: 'YouTube needs a video (no text or image posts through the API)',
  instagram: 'Instagram needs an image or video (text-only posts are not supported)',
};
const PLATFORM_NAME = { youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' };
const DOC_RATIOS = [1, 4 / 5, 16 / 9]; // width / height of carousel pages that display well
const reasonFor = (platform, ct) => (ct === 'document'
  ? `${PLATFORM_NAME[platform]} can't post PDF carousels (LinkedIn only)`
  : UNSUPPORTED_REASON[platform] || `${platform} does not support ${ct} posts`);

/**
 * Evaluate one platform.
 * post = { contentType, caption, title, overrides }, media = media_files rows (ordered)
 * Returns { supported, reason, errors[], warnings[] }
 */
function evaluate(platform, post, media, env = {}) {
  const out = { supported: true, reason: null, errors: [], warnings: [] };
  const ct = post.contentType;
  if (!SUPPORTED[platform].includes(ct)) {
    return { supported: false, reason: reasonFor(platform, ct), errors: [], warnings: [] };
  }
  const o = post.overrides || {};
  const caption = o.caption != null ? o.caption : post.caption || '';
  const err = (m) => out.errors.push(m);
  const warn = (m) => out.warnings.push(m);
  const video = media.find((m) => m.kind === 'video');
  const images = media.filter((m) => m.kind === 'image');
  const dur = video ? Number(video.duration_sec) : 0;
  const ratio = (m) => (m.width && m.height ? m.width / m.height : null);

  if (ct === 'text' && !caption.trim()) err('Text is empty');
  if ((ct === 'image') && !images.length) err('No image attached');
  if ((ct === 'video' || ct === 'reel') && !video) err('No video attached');
  const docs = media.filter((m) => m.kind === 'document');
  if (ct !== 'document' && docs.length) err('A PDF can only be posted as a PDF carousel (contentType "document")');

  if (ct === 'document' && platform === 'linkedin') {
    const r = RULES.linkedin.document;
    const doc = docs[0];
    if (docs.length !== 1 || media.length !== 1) {
      err(docs.length && media.length > docs.length ? 'Remove the images/videos: a PDF carousel is one PDF only' : 'Attach one PDF');
    }
    const title = String((o.title != null ? o.title : post.title) || '');
    if (!title.trim()) err('LinkedIn needs a title for PDF carousels');
    if (title.length > r.maxTitle) err(`Title is ${title.length} characters (max ${r.maxTitle})`);
    if (doc) {
      const pages = Number(doc.page_count) || 0;
      if (Number(doc.size_bytes) > r.maxBytes) err('PDF is over 100 MB (LinkedIn limit)');
      if (pages > r.maxPages) err(`PDF has ${pages} pages (max ${r.maxPages})`);
      if (pages && pages < 2) warn("A one-page document doesn't swipe");
      if (pages > r.recommendedPages[1]) warn(`Carousels over ${r.recommendedPages[1]} pages get fewer completions`);
      const rt = ratio(doc);
      if (rt && !DOC_RATIOS.some((x) => Math.abs(rt / x - 1) <= 0.03)) warn('Pages look best at 1:1, 4:5 or 16:9');
    }
  }

  if (platform === 'linkedin') {
    const r = RULES.linkedin;
    if (caption.length > r.maxText) err(`Text is ${caption.length} characters (max ${r.maxText})`);
    if (video) {
      if (dur < r.video.minSec || dur > r.video.maxSec) err(`Video length must be 3 seconds to 30 minutes`);
      if (video.size_bytes > r.video.maxBytes) err('Video is over 500 MB (LinkedIn limit)');
    }
    if (images.length > r.maxImages) err(`Max ${r.maxImages} images`);
  }

  if (platform === 'youtube') {
    const r = RULES.youtube;
    const title = (o.title != null ? o.title : post.title) || '';
    const desc = caption;
    if (!title.trim()) err('YouTube needs a title');
    if (title.length > r.maxTitle) err(`Title is ${title.length} characters (max ${r.maxTitle})`);
    if (desc.length > r.maxDescription) err(`Description is ${desc.length} characters (max ${r.maxDescription})`);
    if (ct === 'reel') {
      if (dur > r.shortMaxSec) err('Shorts must be 3 minutes or shorter');
    }
    if (!env.youtubeAudited) warn('YouTube API audit not passed yet: video will be uploaded as PRIVATE');
  }

  if (platform === 'facebook') {
    const r = RULES.facebook.reel;
    if (ct === 'reel' && video) {
      if (dur < r.minSec || dur > r.maxSec) err(`Facebook Reels must be ${r.minSec} to ${r.maxSec} seconds`);
      if (ratio(video) && Math.abs(ratio(video) - 9 / 16) > 0.05) err('Facebook Reels must be 9:16 (vertical)');
      if (video.width < r.minWidth || video.height < r.minHeight) err(`Facebook Reels need at least ${r.minWidth}x${r.minHeight}`);
    }
  }

  if (platform === 'instagram') {
    const r = RULES.instagram;
    if (caption.length > r.maxCaption) err(`Caption is ${caption.length} characters (max ${r.maxCaption})`);
    if (hashtags(caption) > r.maxHashtags) err(`Max ${r.maxHashtags} hashtags`);
    if (video) {
      if (dur < r.reel.minSec || dur > r.reel.maxSec) err('Instagram Reels must be 3 seconds to 15 minutes');
      if (ratio(video) && Math.abs(ratio(video) - 9 / 16) > 0.05) warn('Reels look best at 9:16');
    }
    if (ct === 'image') {
      if (images.length > r.carousel.max) err(`Carousels can have at most ${r.carousel.max} items`);
      for (const im of images) {
        const rt = ratio(im);
        if (rt && (rt < r.image.minRatio - 0.01 || rt > r.image.maxRatio + 0.01)) err(`${im.original_name}: aspect ratio must be between 4:5 and 1.91:1`);
        if (!/jpe?g/.test(im.mime_type)) err(`${im.original_name}: Instagram only accepts JPEG images`);
      }
      if (!env.publicBaseUrl) err('PUBLIC_BASE_URL is not set: Instagram needs a public URL to download images');
    }
  }
  return out;
}

module.exports = { RULES, SUPPORTED, evaluate };
