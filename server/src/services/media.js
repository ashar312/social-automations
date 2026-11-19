'use strict';
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const env = require('../config/env');

const abs = (rel) => path.join(env.UPLOAD_ROOT, rel);
const thumbRel = (rel) => `${rel}.thumb.jpg`;

function probe(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) {
        console.warn(`ffprobe failed for ${file}: ${err.message.split('\n').filter(Boolean).pop()}`);
        const broken = /moov atom not found|Invalid data found/i.test(err.message);
        return reject(Object.assign(new Error(broken
          ? 'This video file is incomplete or corrupted (it cannot be read). Re-export or re-download it, check it plays in a media player, then upload again.'
          : `Could not read this media file: ${err.message.split('\n').filter(Boolean).pop()}`), { status: broken ? 400 : 500 }));
      }
      const v = (data.streams || []).find((s) => s.codec_type === 'video');
      let w = v && v.width;
      let h = v && v.height;
      // rotated phone videos report rotation in side data / tags
      const rot = Math.abs(Number((v && v.tags && v.tags.rotate) || (v && v.side_data_list || []).map((x) => x.rotation).find((x) => x != null) || 0));
      if (rot === 90 || rot === 270) [w, h] = [h, w];
      const dur = Number(data.format && data.format.duration);
      resolve({ width: w || null, height: h || null, duration: Number.isFinite(dur) ? dur : null, hasVideo: !!v });
    });
  });
}

function makeThumbnail(rel) {
  return new Promise((resolve) => {
    ffmpeg(abs(rel))
      .on('end', () => resolve(true))
      .on('error', () => resolve(false))
      .screenshots({ timestamps: ['1'], filename: path.basename(thumbRel(rel)), folder: path.dirname(abs(rel)), size: '480x?' });
  });
}

function convertToJpeg(srcAbs, destAbs) {
  return new Promise((resolve, reject) => {
    ffmpeg(srcAbs).outputOptions(['-q:v', '2']).on('end', resolve).on('error', reject).save(destAbs);
  });
}

/** Suggest a content type for a set of media rows. */
function classify(media) {
  if (!media.length) return 'text';
  const vid = media.find((m) => m.kind === 'video');
  if (!vid) return 'image';
  const vertical = vid.width && vid.height && vid.height / vid.width >= 1.5;
  return vertical && Number(vid.duration_sec) <= 180 ? 'reel' : 'video';
}

async function removeFiles(rel) {
  for (const r of [rel, thumbRel(rel)]) await fs.promises.rm(abs(r), { force: true });
}

/** Remove a media row's files unless another media row (e.g. a cross-posted copy) still points at them. */
async function removeUnlessShared(m, ignorePostIds = []) {
  const { MediaFile } = require('../db/models');
  const { Op } = require('sequelize');
  const other = await MediaFile.count({
    where: { stored_path: m.stored_path, id: { [Op.ne]: m.id }, [Op.or]: [{ post_id: null }, { post_id: { [Op.notIn]: ignorePostIds.length ? ignorePostIds : [0] } }] },
  });
  if (!other) await removeFiles(m.stored_path);
  return !other;
}

module.exports = { removeUnlessShared, abs, thumbRel, probe, makeThumbnail, convertToJpeg, classify, removeFiles };
