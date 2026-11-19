'use strict';
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const { MediaFile } = require('../db/models');
const m = require('../services/media');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, m.monthDir()),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!m.MEDIA_EXT.includes(ext)) return cb(Object.assign(new Error(m.UNSUPPORTED), { status: 400 }));
    cb(null, true);
  },
});

/**
 * multer + ingest: POST multipart/form-data with the field "file". Shared by the UI and the external API.
 * When the route set req.project (external API), the upload is scoped to that project.
 */
const handleUpload = [upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file received (field name must be "file")' });
    res.json({ ok: true, ...(await m.ingest(req.file.path, req.file.originalname, { projectId: req.project ? req.project.id : null })) });
  } catch (e) { next(e); }
}];
router.post('/', handleUpload);

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

module.exports = { router, publicRouter, view: m.view, handleUpload, importFromUrl: m.importFromUrl };
