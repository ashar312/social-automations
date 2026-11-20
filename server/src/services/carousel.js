'use strict';
/**
 * Builds a PDF carousel (LinkedIn document post) from uploaded images: one image = one page.
 * Shared by the UI route, the external API (/api/v1/.../media/carousel) and the MCP tool build_carousel_pdf.
 * plans/07-linkedin-pdf-carousel.md section 3.
 */
const fs = require('fs');
const { z } = require('zod');
const env = require('../config/env');
const mediaSvc = require('./media');

const SIZES = { '1080x1350': [1080, 1350], '1080x1080': [1080, 1080], '1920x1080': [1920, 1080] };
const MIN_SLIDES = 2;
const MAX_SLIDES = 20;

const fail = (status, message) => Object.assign(new Error(message), { status });

// The descriptions are shown to AI clients (MCP tool schema).
const carouselShape = {
  mediaIds: z.array(z.number().int()).min(MIN_SLIDES, `A carousel needs at least ${MIN_SLIDES} images`)
    .max(MAX_SLIDES, `A carousel can have at most ${MAX_SLIDES} images`)
    .describe(`${MIN_SLIDES}-${MAX_SLIDES} image media ids from upload_media_*, in slide order`),
  size: z.enum(Object.keys(SIZES)).default('1080x1350')
    .describe('Page size: 1080x1350 (4:5 portrait, default, best on LinkedIn), 1080x1080 (square) or 1920x1080 (16:9)'),
  fit: z.enum(['contain', 'cover']).default('contain')
    .describe('contain = whole image, letterboxed onto the background; cover = fill the page, cropping from the center'),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'background must look like #ffffff').default('#ffffff')
    .describe('Letterbox colour for fit "contain", e.g. "#ffffff"'),
  name: z.string().max(200).nullish().describe('File name for the PDF, e.g. "launch-carousel.pdf"'),
};
const carouselSchema = z.object(carouselShape);

const hexRgb = (hex) => {
  const { rgb } = require('pdf-lib');
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/**
 * Loads the image rows in slide order. They must be unattached uploads; with `api`, they must also have been
 * uploaded through this project (same rule as apiInput in services/posts.js). UI uploads have no project yet.
 */
async function loadSlides(ids, projectId, api) {
  const { MediaFile } = require('../db/models');
  const rows = await MediaFile.findAll({ where: { id: [...new Set(ids)] } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const foreign = ids.filter((i) => {
    const r = byId.get(i);
    if (!r) return true;
    return api ? r.project_id !== projectId : r.project_id != null && r.project_id !== projectId;
  });
  if (foreign.length) throw fail(400, `Unknown media id(s): ${[...new Set(foreign)].join(', ')}. Upload the images through this project first.`);
  const used = rows.filter((r) => r.post_id != null);
  if (used.length) throw fail(400, `Media already used by another post: ${used.map((r) => r.id).join(', ')}. Upload it again.`);
  const notImage = rows.filter((r) => r.kind !== 'image');
  if (notImage.length) throw fail(400, `Only images can become carousel slides (media ${notImage.map((r) => `${r.id} is a ${r.kind}`).join(', ')})`);
  return ids.map((i) => byId.get(i));
}

/**
 * buildCarousel(input, { projectId, api }) → media view of the new PDF (kind 'document').
 * The source image rows and their files are removed once the PDF exists.
 */
async function buildCarousel(raw, { projectId = null, api = false } = {}) {
  const parsed = carouselSchema.safeParse(raw || {});
  if (!parsed.success) throw fail(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  const { mediaIds, size, fit, background, name } = parsed.data;
  const slides = await loadSlides(mediaIds, projectId, api);

  const { PDFDocument } = require('pdf-lib');
  const [W, H] = SIZES[size];
  const pdf = await PDFDocument.create();
  pdf.setTitle((name || 'carousel').replace(/\.pdf$/i, ''));
  pdf.setProducer('Social Automations');
  const embedded = new Map(); // the same image used twice is embedded once
  for (const s of slides) {
    let img = embedded.get(s.id);
    if (!img) {
      const bytes = await fs.promises.readFile(mediaSvc.abs(s.stored_path));
      try {
        img = /png/.test(s.mime_type) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      } catch (e) {
        throw fail(400, `Could not read image ${s.id} ("${s.original_name}"): ${e.message}`);
      }
      embedded.set(s.id, img);
    }
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hexRgb(background) });
    // contain: fit inside; cover: fill and let the page edges crop the overflow (centered)
    const k = fit === 'cover' ? Math.max(W / img.width, H / img.height) : Math.min(W / img.width, H / img.height);
    const w = img.width * k;
    const h = img.height * k;
    page.drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
  }
  const bytes = await pdf.save();
  if (bytes.length > env.DOC_MAX_MB * 1024 * 1024) {
    throw fail(413, `The carousel PDF would be ${(bytes.length / 1048576).toFixed(1)} MB (max ${env.DOC_MAX_MB} MB). Use smaller images.`);
  }

  const dest = mediaSvc.newUploadPath('.pdf');
  await fs.promises.writeFile(dest, bytes);
  let file = String(name || 'carousel').trim() || 'carousel';
  if (!/\.pdf$/i.test(file)) file += '.pdf';
  const out = await mediaSvc.ingest(dest, file, { projectId });

  // Free the source images (rows + files; files stay if a cross-posted copy still points at them)
  for (const s of new Map(slides.map((x) => [x.id, x])).values()) {
    await mediaSvc.removeUnlessShared(s).catch(() => {});
    await s.destroy().catch(() => {});
  }
  return out;
}

module.exports = { buildCarousel, carouselSchema, carouselShape, SIZES, MIN_SLIDES, MAX_SLIDES };
