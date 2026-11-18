'use strict';
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

router.post('/', upload.single('file'), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ ok: false, error: 'No file received (field name must be "file")' });
    let ext = path.extname(file.filename).toLowerCase();
    let absPath = file.path;
    const kind = IMAGE_EXT.includes(ext) ? 'image' : 'video';
    let originalName = file.originalname;

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
    const media = view(row);
    res.json({ ok: true, ...media, suggestedType: m.classify([row]) });
  } catch (e) {
    if (file) await fs.promises.rm(file.path, { force: true }).catch(() => {});
    next(e);
  }
});

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

module.exports = { router, publicRouter, view };
