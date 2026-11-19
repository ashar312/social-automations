'use strict';
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const env = require('../config/env');
const { MediaFile } = require('../db/models');
const m = require('../services/media');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const VIDEO_EXT = ['.mp4', '.mov'];
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const d = new Date();
      const rel = path.join(String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'));
      fs.mkdirSync(path.join(env.UPLOAD_ROOT, rel), { recursive: true });
      cb(null, path.join(env.UPLOAD_ROOT, rel));
    },
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![...IMAGE_EXT, ...VIDEO_EXT].includes(ext)) {
      return cb(Object.assign(new Error('Unsupported file type. Use jpg, png, webp, mp4 or mov.'), { status: 400 }));
    }
    cb(null, true);
  },
});

const view = (r) => ({
  id: r.id, kind: r.kind, name: r.original_name, width: r.width, height: r.height,
  duration: r.duration_sec != null ? Number(r.duration_sec) : null, size: Number(r.size_bytes), mime: r.mime_type,
});

/**
 * Probes a file already inside UPLOAD_ROOT (webp → jpg, thumbnail for videos) and saves the media row.
 * Deletes the file again if anything fails.
 */
async function ingest(absPath, originalName) {
  try {
    let ext = path.extname(absPath).toLowerCase();
    const kind = IMAGE_EXT.includes(ext) ? 'image' : 'video';
    if (ext === '.webp') {
      const jpg = absPath.replace(/\.webp$/, '.jpg');
      await m.convertToJpeg(absPath, jpg);
      await fs.promises.rm(absPath, { force: true });
      absPath = jpg;
      ext = '.jpg';
      originalName = originalName.replace(/\.webp$/i, '.jpg');
    }
    const rel = path.relative(env.UPLOAD_ROOT, absPath).split(path.sep).join('/');
    const info = await m.probe(absPath);
    if (kind === 'video' && !info.hasVideo) throw Object.assign(new Error('File has no video stream'), { status: 400 });
    const stat = await fs.promises.stat(absPath);
    if (kind === 'video') await m.makeThumbnail(rel);

    const row = await MediaFile.create({
      kind, original_name: originalName, stored_path: rel, public_token: crypto.randomBytes(16).toString('hex'),
      mime_type: MIME[ext], size_bytes: stat.size, width: info.width, height: info.height,
      duration_sec: kind === 'video' && info.duration != null ? info.duration.toFixed(2) : null,
    });
    return { ...view(row), suggestedType: m.classify([row]) };
  } catch (e) {
    await fs.promises.rm(absPath, { force: true }).catch(() => {});
    throw e;
  }
}

/** multer + ingest: POST multipart/form-data with the field "file". Shared by the UI and the external API. */
const handleUpload = [upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file received (field name must be "file")' });
    res.json({ ok: true, ...(await ingest(req.file.path, req.file.originalname)) });
  } catch (e) { next(e); }
}];
router.post('/', handleUpload);

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Downloads a public http(s) URL into UPLOAD_ROOT and ingests it (external API). */
async function importFromUrl(rawUrl, name) {
  let u;
  try { u = new URL(rawUrl); } catch { throw bad('url is not a valid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw bad('url must start with http:// or https://');
  const res = await axios.get(u.href, { responseType: 'stream', timeout: 60_000, maxRedirects: 5, validateStatus: () => true });
  if (res.status >= 400) { res.data.destroy(); throw bad(`Download failed: ${u.host} answered ${res.status}`); }

  const byType = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };
  const ctype = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  let ext = path.extname(name || u.pathname).toLowerCase();
  if (![...IMAGE_EXT, ...VIDEO_EXT].includes(ext)) ext = byType[ctype];
  if (!ext) { res.data.destroy(); throw bad('Unsupported file type. Use jpg, png, webp, mp4 or mov.'); }

  const d = new Date();
  const dir = path.join(env.UPLOAD_ROOT, String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'));
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${crypto.randomUUID()}${ext}`);
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
  return ingest(dest, original);
}

async function find(req, res) {
  const r = await MediaFile.findByPk(req.params.id);
  if (!r) res.status(404).json({ ok: false, error: 'Not found' });
  return r;
}

router.get('/:id/file', async (req, res, next) => {
  try {
    const r = await find(req, res);
    if (r) res.sendFile(m.abs(r.stored_path), { headers: { 'Content-Type': r.mime_type } });
  } catch (e) { next(e); }
});
router.get('/:id/thumb', async (req, res, next) => {
  try {
    const r = await find(req, res);
    if (!r) return;
    const p = r.kind === 'image' ? m.abs(r.stored_path) : m.abs(m.thumbRel(r.stored_path));
    res.sendFile(p, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  } catch (e) { next(e); }
});

/** Public route (mounted at /media): only this path is meant to be reachable via the tunnel. */
const publicRouter = require('express').Router();
publicRouter.get('/:token/:filename', async (req, res, next) => {
  try {
    const r = await MediaFile.findOne({ where: { public_token: req.params.token } });
    if (!r) return res.status(404).end();
    res.sendFile(m.abs(r.stored_path), { headers: { 'Content-Type': r.mime_type } });
  } catch (e) { next(e); }
});

module.exports = { router, publicRouter, view, handleUpload, importFromUrl };
