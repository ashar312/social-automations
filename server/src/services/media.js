'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const env = require('../config/env');
const { safeGet } = require('./netGuard');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const VIDEO_EXT = ['.mp4', '.mov'];
const DOC_EXT = ['.pdf'];
const MEDIA_EXT = [...IMAGE_EXT, ...VIDEO_EXT, ...DOC_EXT];
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.pdf': 'application/pdf' };
const EXT_BY_TYPE = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'application/pdf': '.pdf',
};
const UNSUPPORTED = 'Unsupported file type. Use jpg, png, webp, mp4, mov or pdf.';
const kindOf = (ext) => (IMAGE_EXT.includes(ext) ? 'image' : DOC_EXT.includes(ext) ? 'document' : 'video');

const abs = (rel) => path.join(env.UPLOAD_ROOT, rel);
const thumbRel = (rel) => `${rel}.thumb.jpg`;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** UPLOAD_ROOT/YYYY/MM (created), where new uploads go. */
function monthDir() {
  const d = new Date();
  const dir = path.join(env.UPLOAD_ROOT, String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
/** A fresh absolute path in the upload dir for a file with this extension. */
const newUploadPath = (ext) => path.join(monthDir(), `${crypto.randomUUID()}${ext}`);

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
  if (media.length === 1 && media[0].kind === 'document') return 'document';
  const vid = media.find((m) => m.kind === 'video');
  if (!vid) return 'image';
  const vertical = vid.width && vid.height && vid.height / vid.width >= 1.5;
  return vertical && Number(vid.duration_sec) <= 180 ? 'reel' : 'video';
}

/** Public JSON shape of a media row. */
const view = (r) => ({
  id: r.id, kind: r.kind, name: r.original_name, width: r.width, height: r.height,
  duration: r.duration_sec != null ? Number(r.duration_sec) : null, size: Number(r.size_bytes), mime: r.mime_type,
  pageCount: r.page_count != null ? r.page_count : null,
});

/**
 * Checks a PDF on disk: size cap (before reading it into memory), %PDF- magic bytes, then a pdf-lib parse.
 * Returns { pageCount, width, height } (page 1 size in points). Never renders or executes anything.
 */
async function inspectPdf(absPath) {
  const stat = await fs.promises.stat(absPath);
  if (stat.size > env.DOC_MAX_MB * 1024 * 1024) throw bad(`PDF is larger than ${env.DOC_MAX_MB} MB`, 413);
  const fh = await fs.promises.open(absPath, 'r');
  const head = Buffer.alloc(5);
  try { await fh.read(head, 0, 5, 0); } finally { await fh.close(); }
  if (head.toString('latin1') !== '%PDF-') throw bad('This is not a valid PDF');
  const { PDFDocument } = require('pdf-lib');
  const BROKEN = 'PDF is password-protected or damaged. Export it again without a password.';
  let doc;
  try {
    doc = await PDFDocument.load(await fs.promises.readFile(absPath), { updateMetadata: false });
  } catch { throw bad(BROKEN); }
  if (doc.isEncrypted) throw bad(BROKEN);
  const pageCount = doc.getPageCount();
  if (!pageCount) throw bad('This PDF has no pages');
  const { width, height } = doc.getPage(0).getSize();
  return { pageCount, width: Math.round(width), height: Math.round(height) };
}

/**
 * Probes a file already inside UPLOAD_ROOT (webp → jpg, thumbnail for videos) and saves the media row.
 * `projectId` scopes the upload to one project (external API / MCP); null for UI uploads.
 * Deletes the file again if anything fails.
 */
async function ingest(absPath, originalName, { projectId = null, userId = null } = {}) {
  const { MediaFile, Project } = require('../db/models');
  try {
    if (!userId && projectId) userId = (await Project.findByPk(projectId, { attributes: ['user_id'] }))?.user_id || null;
    if (!userId) throw bad('Upload has no owner');
    let ext = path.extname(absPath).toLowerCase();
    const kind = kindOf(ext);
    if (kind === 'document') { // no ffprobe, no thumbnail
      const info = await inspectPdf(absPath);
      const stat = await fs.promises.stat(absPath);
      const row = await MediaFile.create({
        project_id: projectId, user_id: userId, kind, original_name: originalName, stored_path: path.relative(env.UPLOAD_ROOT, absPath).split(path.sep).join('/'),
        public_token: crypto.randomBytes(16).toString('hex'), mime_type: MIME[ext], size_bytes: stat.size,
        width: info.width, height: info.height, page_count: info.pageCount,
      });
      return { ...view(row), suggestedType: classify([row]) };
    }
    if (ext === '.webp') {
      const jpg = absPath.replace(/\.webp$/, '.jpg');
      await convertToJpeg(absPath, jpg);
      await fs.promises.rm(absPath, { force: true });
      absPath = jpg;
      ext = '.jpg';
      originalName = originalName.replace(/\.webp$/i, '.jpg');
    }
    const rel = path.relative(env.UPLOAD_ROOT, absPath).split(path.sep).join('/');
    const info = await probe(absPath);
    if (kind === 'video' && !info.hasVideo) throw bad('File has no video stream');
    const stat = await fs.promises.stat(absPath);
    if (kind === 'video') await makeThumbnail(rel);

    const row = await MediaFile.create({
      project_id: projectId, user_id: userId, kind, original_name: originalName, stored_path: rel, public_token: crypto.randomBytes(16).toString('hex'),
      mime_type: MIME[ext], size_bytes: stat.size, width: info.width, height: info.height,
      duration_sec: kind === 'video' && info.duration != null ? info.duration.toFixed(2) : null,
    });
    return { ...view(row), suggestedType: classify([row]) };
  } catch (e) {
    await fs.promises.rm(absPath, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * Downloads a public http(s) URL into UPLOAD_ROOT and ingests it (external API / MCP).
 * Private, loopback and link-local targets are refused (SSRF guard, also on redirects).
 */
async function importFromUrl(rawUrl, name, opts = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw bad('url is not a valid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw bad('url must start with http:// or https://');
  const res = await safeGet(u.href);
  if (res.status >= 400) { res.data.destroy(); throw bad(`Download failed: ${u.host} answered ${res.status}`); }

  const ctype = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  let ext = path.extname(name || u.pathname).toLowerCase();
  if (!MEDIA_EXT.includes(ext)) ext = EXT_BY_TYPE[ctype];
  if (!ext) { res.data.destroy(); throw bad(UNSUPPORTED); }

  const dest = newUploadPath(ext);
  const max = env.MAX_UPLOAD_MB * 1024 * 1024;
  let seen = 0;
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      res.data.on('data', (c) => {
        seen += c.length;
        if (seen > max) res.data.destroy(bad(`File is larger than ${env.MAX_UPLOAD_MB} MB`, 413));
      });
      res.data.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.data.pipe(out);
    });
  } catch (e) {
    await fs.promises.rm(dest, { force: true }).catch(() => {});
    throw e.status ? e : bad(`Download failed: ${e.message}`);
  }
  let original = name || decodeURIComponent(path.basename(u.pathname)) || 'download';
  if (path.extname(original).toLowerCase() !== ext) original += ext;
  return ingest(dest, original, opts);
}

/** Saves an in-memory file (base64 from MCP) into UPLOAD_ROOT and ingests it. */
async function importBuffer(buf, filename, mimeType, opts = {}) {
  let ext = path.extname(filename || '').toLowerCase();
  if (!MEDIA_EXT.includes(ext)) ext = EXT_BY_TYPE[String(mimeType || '').toLowerCase()];
  if (!ext) throw bad(UNSUPPORTED);
  if (!buf.length) throw bad('The file is empty');
  const dest = newUploadPath(ext);
  await fs.promises.writeFile(dest, buf);
  let original = path.basename(filename || 'upload');
  if (path.extname(original).toLowerCase() !== ext) original += ext;
  return ingest(dest, original, opts);
}

/** Copies a local file (already path-checked by the caller) into UPLOAD_ROOT and ingests it. */
async function importLocalFile(srcAbs, opts = {}) {
  const ext = path.extname(srcAbs).toLowerCase();
  if (!MEDIA_EXT.includes(ext)) throw bad(UNSUPPORTED);
  const st = await fs.promises.stat(srcAbs);
  if (!st.isFile()) throw bad('Not a file');
  if (st.size > env.MAX_UPLOAD_MB * 1024 * 1024) throw bad(`File is larger than ${env.MAX_UPLOAD_MB} MB`, 413);
  const dest = newUploadPath(ext);
  await fs.promises.copyFile(srcAbs, dest);
  return ingest(dest, path.basename(srcAbs), opts);
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

module.exports = {
  removeUnlessShared, abs, thumbRel, probe, makeThumbnail, convertToJpeg, classify, removeFiles,
  view, ingest, importFromUrl, importBuffer, importLocalFile, monthDir, newUploadPath, inspectPdf,
  IMAGE_EXT, VIDEO_EXT, DOC_EXT, MEDIA_EXT, MIME, UNSUPPORTED,
};
