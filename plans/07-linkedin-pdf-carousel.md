# 07: LinkedIn PDF carousels (document posts) in the UI and through MCP

## Status (2026-11-20)

- **Built:** B2, B3, B4, B6, B7, B8 (code and docs). Migration `20261121000001-linkedin-documents` has been applied.
- **Not run yet: B1.** `server/scripts/li-doc-smoke.js` is written but has not been run, because it posts to a real LinkedIn profile (as a `CONNECTIONS`-only post, deleted again afterwards). Run `node --use-system-ca scripts/li-doc-smoke.js` from `server/`, then note the response shapes here. The adapter follows the shapes described in "Background" below.
- **Skipped (optional): B5** server-side thumbnails. History shows a PDF icon instead. The MCP media resource returns the PDF itself (under `MCP_MAX_INLINE_MB`) plus a text note with the page count.
- **Changes from the plan:**
  - `posts.title` was widened to `VARCHAR(400)` in the same migration, because carousel titles can be up to 400 characters.
  - The v1 carousel route is `POST /api/v1/projects/{pid}/media/carousel`, next to the other v1 media routes, not `/api/v1/media/carousel`.
  - The self-test checks that the `build_carousel_pdf` tool is listed and runs the rules on an in-memory 3-page PDF fixture. It does not upload anything, so the test has no side effects.
  - `Overview.jsx` has no content-type map, so nothing changed there.
  - The UI serves the PDF preview from `/api/media/:id/file` (inline, `application/pdf`), not from the public `/media/:token/...` URL.

## Goal

Publish **swipeable PDF carousels** to LinkedIn (LinkedIn calls them *document posts*) from:

1. **The UI**: drop a PDF into Compose, *or* build one from a set of images (one image = one slide), preview it as a swipeable carousel, give it a title, and post.
2. **MCP / external API**: an AI uploads a PDF (URL, base64, local path) *or* asks the server to assemble one from uploaded images, then validates and posts it with the same `validate_post` → `create_post` → `wait_for_post` flow it already uses.

Every other platform stays the same. A `document` post to YouTube, Facebook or Instagram is **skipped** with a clear reason. It is not an error.

## Background: how LinkedIn does it

- The LinkedIn API has **no native image-carousel post** for organic content. `multiImage` (which we already send for 2+ images) shows up as a grid. The swipeable "carousel" people see in the feed is a **document post**: a PDF (or PPT/PPTX/DOC/DOCX) that LinkedIn renders page by page.
- Flow (Documents API, same versioned `/rest` base and headers as `platforms/linkedin.js` already uses):
  1. `POST /rest/documents?action=initializeUpload` with `{ initializeUploadRequest: { owner } }` returns `{ value: { uploadUrl, document } }` (`urn:li:document:…`).
  2. `PUT uploadUrl` with the raw bytes (single PUT, not chunked like video).
  3. Poll `GET /rest/documents/{urn}` until `status: AVAILABLE` (or `PROCESSING_FAILED`).
  4. `POST /rest/posts` with `content: { media: { id: <document urn>, title: <title> } }`. **`title` is required** for documents, and it appears as the carousel's header in the feed.
- Limits: **100 MB**, **300 pages** max. In practice keep carousels to **5 to 20 pages**, square (1080×1080) or portrait (1080×1350, 4:5) pages. No passwords or encryption.
- Scopes: `w_member_social` (personal profile) or `w_organization_social` (Page, when `externalId` is `urn:li:organization:…`). We already request these. **No new LinkedIn product or approval is needed.**

> **Check during build (B1):** confirm the request and response shapes against the LinkedIn API version pinned in `LINKEDIN_API_VERSION` (`202611`). Documents API fields have been stable, but verify `title` placement and the polling status values on one real upload before building on them.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | New content type **`document`** (UI label: **"PDF carousel"**) and new media kind **`document`** | It doesn't fit `image`/`video`: different upload API, different limits, a required title. A separate type keeps `rules.js` and the adapters simple, and lets other platforms say "skipped" cleanly |
| D2 | **PDF only** in v1 (no PPT/DOCX) | PDF is what carousels are made of. We can read and validate it in pure JS. Office files would need LibreOffice to preview or count pages |
| D3 | **`pdf-lib`** on the server (page count, page size, encryption check, *and* building PDFs from images) | Pure JS, no native deps, works on Windows, handles both reading and writing. One dependency covers both features |
| D4 | **`pdfjs-dist`** in the client for the live carousel preview | Renders the real pages in the browser, so the preview matches what LinkedIn shows. Load it lazily, only when a PDF is on the page |
| D5 | Server-side **cover thumbnail** (page 1 → JPEG) is **optional** (phase B5). Fall back to a generic PDF icon | Rendering a PDF in Node needs `pdfjs-dist` + `@napi-rs/canvas` (a native module). History/MCP previews are nice to have, not essential |
| D6 | **"Build carousel from images"** creates a **real PDF media row** (server-side, via `pdf-lib`) and then goes down the same path as an uploaded PDF | One publish path. The UI and MCP share it (`services/carousel.js`). The images used are freed afterwards |
| D7 | `document` is **LinkedIn-only** in `SUPPORTED` | Facebook/Instagram/YouTube APIs can't post PDFs. Converting PDF pages into an Instagram image carousel is noted as a follow-up (section 9), not part of this plan |

## 1. Database (migration `20261121000001-linkedin-documents`)

| Table | Change |
|---|---|
| `media_files.kind` | ENUM `('image','video','thumbnail')` → add **`'document'`** |
| `media_files` | add **`page_count INT NULL`**. For PDFs, also reuse `width`/`height` for **page 1 size in points** (lets rules warn about odd aspect ratios) |
| `posts.content_type` | ENUM `('text','image','video','reel')` → add **`'document'`** |

Update the models `MediaFile.js` and `Post.js` to match. `down` reverts the ENUMs, but it must fail with a clear message if any `document` rows exist (MySQL would otherwise truncate them silently). Update `plans/01-database.md`.

## 2. Server: media pipeline (`services/media.js`, `routes/media.js`)

- `DOC_EXT = ['.pdf']`. Add it to `MEDIA_EXT`, `MIME['.pdf'] = 'application/pdf'`, `EXT_BY_TYPE['application/pdf'] = '.pdf'`. Update `UNSUPPORTED` to read "Use jpg, png, webp, mp4, mov or pdf."
- `ingest()` gets a `document` branch that **skips ffprobe and thumbnail**:
  1. **Magic bytes**: the first 5 bytes must be `%PDF-`. Otherwise "This is not a valid PDF".
  2. `PDFDocument.load(bytes, { updateMetadata: false })` reads `getPageCount()` and the page 1 `getSize()`. If loading fails or the file is encrypted: "PDF is password-protected or damaged. Export it again without a password."
  3. Size cap `DOC_MAX_MB` (env, default **100**). Reject over-size files *before* loading them into memory.
  4. Save the row with `kind: 'document'`, `page_count`, `width`/`height` = page 1 size.
- `view()` adds `pageCount`. `classify()` returns **`'document'`** when the media is a single PDF.
- `routes/media.js` multer `fileFilter` already uses `MEDIA_EXT`, so it picks up `.pdf` automatically. `importFromUrl` / `importBuffer` / `importPath` pick it up through `EXT_BY_TYPE` / `MEDIA_EXT`.
- `MediaFile` serving (`/media/:token/...`): send `Content-Type: application/pdf` plus `Content-Disposition: inline` so the browser preview works.

## 3. Server: build a carousel from images (`services/carousel.js`, new)

```
buildCarousel({ mediaIds, size = '1080x1350', fit = 'contain', background = '#ffffff', name }, { projectId }) → media view (kind: 'document')
```

- Loads the image rows in order (same project-scoping rules as `apiInput`: same project, not already used by a post).
- `pdf-lib`: one page per image at the chosen size. Supported sizes: `1080x1080` (1:1), `1080x1350` (4:5, the default and LinkedIn's best-performing shape), `1920x1080` (16:9). The size is in PDF points, and LinkedIn scales it. `fit: contain` letterboxes onto `background`; `cover` crops from the center. PNG goes in via `embedPng` and JPEG via `embedJpg`. WebP is already converted to JPEG at ingest.
- Limits: **2 to 20 images** (LinkedIn allows 300 pages, but carousels longer than 20 perform badly and the in-memory build gets heavy). Output must stay under `DOC_MAX_MB`.
- Writes to `newUploadPath('.pdf')` and goes through `ingest()`, so validation and page counting run on the result. The source image rows are deleted (or marked for cleanup) once the PDF exists.
- Routes: `POST /api/projects/:id/media/carousel` (UI) and `POST /api/v1/media/carousel` (external API, uses `apiAuth`).

## 4. Server: rules (`platforms/rules.js`)

```js
linkedin: {
  ...,
  document: { maxBytes: 100 * 1024 * 1024, maxPages: 300, maxTitle: 400, recommendedPages: [5, 20] },
}
SUPPORTED.linkedin = ['text', 'image', 'video', 'reel', 'document']
UNSUPPORTED_REASON: youtube / facebook / instagram add: "<Platform> can't post PDF carousels (LinkedIn only)"
```

`evaluate()` for `document`:

| Check | Level |
|---|---|
| exactly one media item, and it is `kind: 'document'` | error ("Attach one PDF") |
| no images/videos mixed in | error |
| `title` (per-target `overrides.title` or `post.title`) present and ≤ 400 chars | error ("LinkedIn needs a title for PDF carousels") |
| size ≤ 100 MB, pages ≤ 300 | error |
| pages < 2 | warning ("A one-page document doesn't swipe") |
| pages > 20 | warning ("Carousels over 20 pages get fewer completions") |
| page 1 aspect ratio not 1:1, 4:5 or 16:9 (±3%) | warning |

`/api/v1/rules` and the MCP `get_platform_rules` tool return `RULES`, so they expose this automatically.

## 5. Server: LinkedIn adapter (`platforms/linkedin.js`)

- `base.js`: add `documentOf(ctx) = ctx.media.find((x) => x.kind === 'document')`.
- New `uploadDocument(ctx, acc, mf)`: initialize, then a single PUT (`Content-Type: application/octet-stream`, `Authorization` header like `uploadImage`), then `setStatus('processing')` and poll `GET /rest/documents/{urn}` every 3 s for up to 3 min, logging the status. `PROCESSING_FAILED` throws a `PublishError`. A timeout throws a `PublishError` with `retryable: true`. Report progress as 10 / 60 / 80.
- `publish()`: check for a document **before** video/images:
  ```js
  const doc = documentOf(ctx);
  if (doc) body.content = { media: { id: await uploadDocument(ctx, acc, doc), title: title || doc.original_name.replace(/\.pdf$/i, '') } };
  ```
- `remove()` needs no change (it deletes the post, and LinkedIn cleans up the document asset).
- `publisher.js` needs no change: it already loads media by `post_id` ordered by `position`.

## 6. Server: post schema (`services/posts.js`)

- `contentType: z.enum(['text','image','video','reel','document'])`, with the describe text extended: *"document = PDF carousel (LinkedIn only; needs a title)"*.
- `title` describe: *"Video title (YouTube) or carousel title (LinkedIn PDF). Required for both"*.
- `targets[].overrides` describe: add *"linkedin: title (carousel header for document posts)"*.

The MCP tools and v1 reuse this schema, so they pick up the change with no extra work (05-mcp-server D-section: "MCP and REST validation can never drift").

## 7. UI

### 7.1 Compose (`client/src/pages/Compose.jsx`)

- File input `accept` adds `.pdf`. In `addFiles`, a PDF **replaces** all media (like a video does). Adding images after a PDF replaces the PDF.
- `suggestType()` returns `'document'` for a single PDF. The content-type `<select>` adds **"PDF carousel (LinkedIn)"**.
- **Media card for a PDF** → new component `client/src/components/CarouselPreview.jsx`:
  - Lazy-loads `pdfjs-dist` (`import('pdfjs-dist')`, worker set via `?url` import) and renders pages to `<canvas>` at card width.
  - LinkedIn-style frame: title bar at the top, the current page, prev/next arrows, a page counter "3 / 12", swipe (pointer events) and arrow-key support, and a thumbnail strip below.
  - Renders lazily: only the current page ±1 and the thumbnails as they scroll into view, so a 100-page PDF doesn't freeze the tab.
  - Shows page count, page size/ratio and file size, plus the rule warnings from validation inline.
- **Title field**: shown and required when `contentType === 'document'`, labelled "Carousel title (shown above the slides on LinkedIn)". Prefilled from the file name without `.pdf`. A per-LinkedIn override is in the LinkedIn tab.
- **"Make a carousel from these images"** button: shown when 2 or more images are attached and LinkedIn is connected. It opens a small dialog with a size picker (1:1 · 4:5 · 16:9 with mini previews), fit (contain/cover), background colour, and drag-to-reorder slides. Confirming calls `POST …/media/carousel`, replaces the images with the returned PDF and switches the type to `document`. Instagram/Facebook users who also want the images keep them by **not** converting. Note this in the dialog's helper text.
- The platform list already greys out unsupported platforms from the validate results ("skipped" reason), so YouTube/FB/IG show "LinkedIn only" with no extra code.

### 7.2 History / PostDetail / Overview

- `History.jsx` `TYPE_ICON.document = FaFilePdf` (react-icons/fa6), with the label "PDF carousel · N pages".
- `PostDetail.jsx`: for `document` posts, render `CarouselPreview` from `/media/:token/...` (falling back to "file removed" after retention cleanup). The LinkedIn live link is already shown.
- Overview counts/charts that group by content type: add `document` to the type map and legend.

### 7.3 Integration page

- REST tab: document the `contentType: "document"` example and `POST /api/v1/media/carousel`.
- The MCP tab tool catalog is generated from the server listing, so the new tool shows up automatically. Add one example prompt card: *"Turn these 6 slides into a LinkedIn carousel titled …"*.

## 8. MCP

| Change | Where | Notes |
|---|---|---|
| Upload tools accept PDFs | `mcp/tools/media.js` | Update the descriptions of `upload_media_from_url`, `upload_media_base64` and `upload_media_from_path` to "image, video or PDF". Base64 stays capped at `MCP_MAX_INLINE_MB` (10 MB covers most carousels; bigger PDFs go by URL/path) |
| **New tool `build_carousel_pdf`** | `mcp/tools/media.js` → `services/carousel.js` | `{ mediaIds (2–20 image ids, slide order), size?: '1080x1350'\|'1080x1080'\|'1920x1080', fit?: 'contain'\|'cover', background?: '#rrggbb', name? }` → media `{ id, kind: 'document', pageCount, suggestedType: 'document' }`. Annotations: not read-only, not destructive, not open-world. Description: *"Use this when the user has slide images (e.g. ones you generated) and wants a LinkedIn carousel. Upload each image first with upload_media_*, then call this, then create_post with contentType 'document' and a title."* |
| `format.media()` | `mcp/format.js` | For documents print `document, 12 pages, 1080x1350` instead of the video duration, plus the hint "Needs a title in create_post" |
| `format.post()` / `postList()` | `mcp/format.js` | `document` already prints through `contentType`. Add the page count when it is known |
| Media preview resource | `mcp/resources.js` | `kind === 'document'` → serve the page-1 thumbnail if B5 is built. Otherwise return the resource as `application/pdf` (blob) under the inline cap, or a text note with the page count |
| **New prompt `linkedin_carousel`** | `mcp/prompts.js` | Args: `topic`, `slides?` (URLs/paths, or empty for "outline only"). Steps: get_project → check LinkedIn is connected → propose a slide outline (hook slide, 4–8 value slides, CTA slide) and a title and caption → wait for OK → upload the slide images (or the user's PDF) → `build_carousel_pdf` → `validate_post` (contentType `document`, target linkedin) → show the summary and wait for OK → `create_post` → `wait_for_post` → live link |
| Server instructions | `mcp/server.js` | One line: *"PDF carousels are LinkedIn-only: contentType 'document', exactly one PDF media id, title required."* |
| Self-test | `mcp/selfTest.js` | Add: list tools includes `build_carousel_pdf`. A `validate_post` with a fixture 3-page PDF returns linkedin OK and the others skipped |

The rate limits, audit log, `mcpPublishNow` (schedule-only) and key scoping all apply unchanged.

## 9. Out of scope / follow-ups

- **PDF → Instagram/Facebook image carousel**: rasterize the pages (needs the B5 renderer) into JPEGs and post them as an image carousel on Meta. A natural next step once B5 exists.
- An in-app **slide designer** (text-on-template slides). For now, slides come from Canva/Figma/AI-generated images or a finished PDF.
- PPT/PPTX/DOCX uploads (LinkedIn accepts them, but we'd need LibreOffice to preview and count pages).
- LinkedIn per-document analytics.

## 10. Phases

| Phase | Tasks | Done when |
|---|---|---|
| **B1: Verify API** | Script `server/scripts/li-doc-smoke.js`: upload a 3-page PDF, poll, create a **`visibility: CONNECTIONS`** test post, delete it. Pin the exact request/response shapes | A carousel shows in the feed and is deleted again. Shapes are noted in this doc |
| **B2: Data + ingest** | Migration, models, `pdf-lib`, the `ingest` document branch, `DOC_MAX_MB` env (+ `.env.example`, `03-env-config.md`), media serving `Content-Type` | Uploading a PDF via the UI route and v1 returns `{ kind: 'document', pageCount }`. An encrypted, fake (`.pdf` that is really a PNG) or over-size PDF is rejected with a clear message |
| **B3: Rules + adapter** | `rules.js` document rules, `documentOf`, `uploadDocument`, schema enum/descriptions | `validate_post` with a PDF: linkedin OK (or title error), others skipped. A real publish via `curl` to v1 goes live with a title. Retry works after a forced failure |
| **B4: Carousel builder** | `services/carousel.js`, the UI and v1 routes, the `build_carousel_pdf` MCP tool | 5 mixed PNG/JPG images of different sizes → a 5-page 1080×1350 PDF, correctly letterboxed/cropped. Source images are freed. Project scoping is enforced |
| **B5 (optional): Thumbnails** | `pdfjs-dist` + `@napi-rs/canvas` page-1 JPEG (`stored_path + '.thumb.jpg'`, same as videos) | History cards and the MCP media resource show the cover image. Falls back to the icon if rendering fails |
| **B6: Compose UI** | `CarouselPreview` (lazy pdf.js), PDF handling in `addFiles`, type option, title field, "make carousel" dialog | Drop a PDF, swipe through the real pages, enter a title, publish to LinkedIn. Images → carousel → publish also works. A 100-page PDF stays responsive |
| **B7: History/Detail/Overview/Integration** | icons, preview on PostDetail, type map, docs on the Integration page | Document posts look right everywhere, and the Integration REST/MCP docs show the new type and tool |
| **B8: MCP polish + docs** | format, resources, prompt, server instruction, selfTest; update `guides/api.md`, `05-mcp-server.md` (tool table), `00-architecture.md` (support matrix), `README.md` index | From Claude Code: *"make a LinkedIn carousel from these 6 images titled X and schedule it for tomorrow 9am"* runs the whole flow with no manual steps besides the confirmation |

## 11. Files touched (checklist)

**Server**: `db/migrations/20261121000001-linkedin-documents.js` (new), `db/models/MediaFile.js`, `db/models/Post.js`, `services/media.js`, `services/carousel.js` (new), `services/posts.js`, `platforms/base.js`, `platforms/linkedin.js`, `platforms/rules.js`, `routes/media.js` / `routes/projects.js` / `routes/v1.js` (carousel route), `config/env.js`, `.env.example`, `mcp/tools/media.js`, `mcp/format.js`, `mcp/resources.js`, `mcp/prompts.js`, `mcp/server.js`, `mcp/selfTest.js`, `package.json` (`pdf-lib`; B5: `pdfjs-dist`, `@napi-rs/canvas`).

**Client**: `pages/Compose.jsx`, `components/CarouselPreview.jsx` (new), `components/CarouselBuilderDialog.jsx` (new), `pages/History.jsx`, `pages/PostDetail.jsx`, `pages/Overview.jsx`, `pages/Integration.jsx`, `api.js` (`buildCarousel()` helper), `package.json` (`pdfjs-dist`).

**Plans/docs**: `01-database.md`, `03-env-config.md`, `05-mcp-server.md`, `00-architecture.md`, `guides/api.md`, `README.md`.

## 12. Risks

| Risk | Mitigation |
|---|---|
| LinkedIn Documents API shape differs in the pinned version | B1 smoke test before anything else is built |
| Large PDFs loaded fully into memory (`pdf-lib`) | Check the size cap before loading. 100 MB max. The carousel builder caps at 20 images |
| Malicious PDFs | Check the magic bytes, parse with `pdf-lib` only (no execution), never render on the server unless B5 is built. The PDF is only ever passed through to LinkedIn and pdf.js in the browser (sandboxed, `isEvalSupported: false`) |
| Title forgotten by AI clients | Schema description, server instruction, validation error and `format.media` hint all say it |
| Users expect the carousel on Instagram too | "LinkedIn only" skip reason in the UI, plus a note in the builder dialog. The follow-up in section 9 covers it |
