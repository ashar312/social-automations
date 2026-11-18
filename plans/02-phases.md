# 02: Build Plan (Phases)

Each phase ends with a **"Done when"** check. Don't start the next phase until it passes.

```
Phase 0  Platform setup (guides) ── runs in parallel with Phases 1 to 3, some steps take days
Phase 1  Scaffolding + DB
Phase 2  Connections (OAuth for all 3 platforms)
Phase 3  Composer + media upload
Phase 4  Publishing engine + 4 adapters   ← the core
Phase 5  History, retry, dashboard
Phase 6  Polish: scheduling, token alerts, webhooks (optional)
```

---

## Phase 0: Platform setup (do this first, alongside coding)

Follow the guides in `plans/guides/`. At the end you should have the values for `03-env-config.md`.

- [ ] **LinkedIn:** create the developer app, add the *Share on LinkedIn* and *Sign In with LinkedIn using OpenID Connect* products, add the redirect URL → [guide](guides/linkedin-setup.md)
- [ ] **YouTube:** create the Google Cloud project, enable YouTube Data API v3, set up the OAuth consent screen and client, **submit the audit form** → [guide](guides/youtube-setup.md)
- [ ] **Meta:** convert IG to a Professional account, link it to a Facebook Page, create the Meta app and add permissions → [guide](guides/meta-instagram-facebook-setup.md)
- [ ] **Public URL:** install cloudflared or ngrok and confirm you get an HTTPS URL → [guide](guides/public-media-url.md)
- [ ] Install **ffmpeg** (it includes ffprobe) and add it to PATH: `winget install Gyan.FFmpeg`
- [ ] Confirm **MySQL** is running locally and you can log in as `root`

**Done when:** you have client IDs and secrets for all three platforms and a working tunnel URL.

---

## Phase 1: Project scaffolding + database

### Tasks
1. Root: `git init`, plus a `.gitignore` covering `node_modules`, `.env`, `server/uploads/`, `dist`.
2. **Server** (`server/`)
   - `npm init`, then install: `express`, `sequelize`, `mysql2`, `dotenv`, `multer`, `axios`, `googleapis`, `fluent-ffmpeg`, `cors`, `morgan`, `zod` (validation)
   - Dev: `sequelize-cli`, `nodemon`
   - `.sequelizerc` pointing to `src/db/{models,migrations,seeders}` and `src/config/database.js`
   - `src/config/env.js`: load and validate `.env` with zod, and fail fast if a value is missing
   - Express app: JSON body, `/api/health` endpoint, error handler middleware, listen on `127.0.0.1:${PORT}`
3. **Database**
   - Script `npm run db:create` → `sequelize db:create` (creates `social_automations` with utf8mb4)
   - Migrations for every table in `01-database.md`
   - Models plus associations
   - `npm run db:migrate` / `db:migrate:undo`
4. **Client** (`client/`)
   - `npm create vite@latest client -- --template react`
   - `react-router-dom`, plus a UI kit of your choice (suggestion: Tailwind CSS + a few headless components)
   - `vite.config.js` proxy: `/api` and `/media` → `http://127.0.0.1:5000`
   - Layout with nav: **Compose · History · Connections**
5. Root `package.json` with `concurrently` so `npm run dev` starts both.

### Done when
- `npm run dev` starts both apps, and `http://localhost:5173` shows the layout
- `GET /api/health` returns `{ ok: true, db: "connected" }`
- All tables exist in MySQL after `npm run db:migrate`

---

## Phase 2: Connections (OAuth + token storage)

### Tasks
1. `services/crypto.js`: `encrypt(text)` and `decrypt(blob)` with AES-256-GCM, using `TOKEN_ENCRYPTION_KEY` (32 bytes, hex) from `.env`.
2. OAuth routes (one pair per provider):
   - `GET /api/oauth/:platform/start` → creates the `oauth_states` row and redirects to the provider
   - `GET /api/oauth/:platform/callback` → checks the state, exchanges the code for tokens, fetches the profile, upserts `platform_accounts`, redirects to `http://localhost:5173/connections?connected=:platform`
3. **LinkedIn:** scopes `openid profile email w_member_social`. After the exchange, call `GET /v2/userinfo`, and `sub` gives you the person URN `urn:li:person:{sub}`. Save `expires_in` (≈60 days).
4. **YouTube (Google):** scope `https://www.googleapis.com/auth/youtube.upload` + `https://www.googleapis.com/auth/youtube.readonly`, with `access_type=offline` and `prompt=consent` so you get a refresh token. Call `channels.list?mine=true` for the channel name and ID.
5. **Meta (one flow creates both rows):** scopes `pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management`.
   - Exchange the code → short-lived user token → **long-lived user token** (`grant_type=fb_exchange_token`)
   - `GET /me/accounts` → list Pages (each one carries a **Page access token**, which doesn't expire when it comes from a long-lived user token)
   - If you have more than one Page, show a picker in the UI. Otherwise auto-select.
   - `GET /{page-id}?fields=instagram_business_account` → IG user ID
   - Save a `facebook` row (Page token) and an `instagram` row (same Page token, `external_id` = IG user ID)
6. `GET /api/connections`: list accounts with status, expiry date and days left (never return tokens to the client).
7. `POST /api/connections/:platform/test`: a cheap API call to confirm the token still works.
8. `DELETE /api/connections/:platform`: disconnect.
9. **Connections page** in the UI: one card per platform with Connect/Reconnect/Test/Disconnect buttons and an expiry badge.

### Done when
- All 4 cards show **Connected** with your real name, channel or page
- "Test" succeeds for each
- Tokens in MySQL are unreadable ciphertext

---

## Phase 3: Composer + media upload

### Tasks
1. `POST /api/media` (multer, disk storage, size limit ~4 GB): saves to `uploads/YYYY/MM/<uuid>.<ext>`, runs ffprobe, returns `{ id, kind, width, height, duration, size }`.
   - Images: jpg/png (convert webp to jpg, since IG only takes JPEG for images)
   - Videos: mp4/mov (H.264 + AAC is safest everywhere)
   - Auto-generate a thumbnail frame for videos (ffmpeg at 1s)
2. `services/media.js` → `classify()`: picks a suggested `content_type`. Vertical (9:16) and ≤ 3 min → `reel`; other video → `video`.
3. **Per-platform validation rules** (as data, so you can edit them easily):
   - LinkedIn: text ≤ 3,000; video 3s to 30 min, ≤ 500 MB; up to 20 images
   - YouTube: title ≤ 100, description ≤ 5,000; Shorts need vertical and ≤ 3 min
   - Facebook: Reels 3 to 90s, 9:16, ≥ 540×960 *(check the current FB limits during the build)*
   - Instagram: caption ≤ 2,200, ≤ 30 hashtags; Reels 3s to 15 min, 9:16 recommended; images JPEG, aspect 4:5 to 1.91:1; carousel 2 to 10 items
4. `POST /api/posts`: body `{ contentType, caption, title, mediaIds[], targets: [{ platform, overrides }], publishNow: true }` → creates the `posts` and `post_targets` rows (`pending`, or `skipped` with a reason if the platform doesn't support the content).
5. `POST /api/posts/validate`: same body, returns warnings and errors per platform without saving.
6. **Composer UI**
   - Drag-and-drop upload with a progress bar
   - Preview (image, or video player)
   - Caption box with a character counter per platform
   - Platform toggles: greyed out with a tooltip when unsupported, and disabled when not connected
   - Tabs per platform for overrides (YouTube title/privacy/tags, IG share-to-feed…)
   - **Publish** button → shows live validation first

### Done when
- You can upload a vertical video and see it auto-detected as a "reel", with all 4 platforms enabled
- Uploading text-only greys out YouTube and Instagram with a reason
- Submitting creates the DB rows. Nothing is published yet.

---

## Phase 4: Publishing engine (core)

### 4.0 Worker
- `worker/publisher.js` starts with the server and ticks every 5s:
  1. Claim jobs: `UPDATE post_targets SET locked_at=NOW() WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=NOW()) AND locked_at IS NULL LIMIT 2` (run up to 2 jobs at once)
  2. Load the account, check or refresh the token, then call `adapter.publish(ctx)`
  3. On success → `published` with `external_id` and `external_url`
  4. On failure → increment `attempts`. If the error is retryable (5xx, timeout, rate limit) and attempts < 3, set backoff (1 min, 5 min, 15 min) and go back to `pending`. Otherwise → `failed`
  5. Roll up `posts.status`
- On startup: reset stale `locked_at` (older than 30 min) and `uploading`/`processing` rows back to `pending` (crash recovery)
- `setProgress()` and `log()` helpers write to `post_targets.progress` and `activity_logs`

### 4.1 LinkedIn adapter (start here, it's the simplest)
Headers: `Authorization: Bearer`, `LinkedIn-Version: YYYYMM` (current month or one that's still supported), `X-Restli-Protocol-Version: 2.0.0`.
- **Text:** `POST https://api.linkedin.com/rest/posts` with `author: urn:li:person:{id}`, `commentary`, `visibility: PUBLIC`, `distribution: { feedDistribution: MAIN_FEED }`, `lifecycleState: PUBLISHED`
- **Image:** `POST /rest/images?action=initializeUpload` → PUT the bytes to `uploadUrl` → create the post with `content.media.id = urn:li:image:...` (multi-image: `content.multiImage.images[]`)
- **Video:** `POST /rest/videos?action=initializeUpload` (send `fileSizeBytes`) → PUT each chunk to its `uploadInstructions[]` URL and collect the `ETag`s → `POST /rest/videos?action=finalizeUpload` → poll `GET /rest/videos/{urn}` until `AVAILABLE` → create the post with `content.media.id = urn:li:video:...`
- The post ID comes back in the `x-restli-id` header → URL `https://www.linkedin.com/feed/update/{urn}`
- Note: LinkedIn treats `( ) [ ] { } < > @ | ~ _ *` as special characters in `commentary`. Escape them.

### 4.2 Facebook Page adapter
Base: `https://graph.facebook.com/vXX.0` (pin the version in `.env`). Uses the **Page token**.
- **Text:** `POST /{page-id}/feed` `message=...`
- **Image:** `POST /{page-id}/photos` multipart `source` + `caption` (no public URL needed). Multi-image: upload each with `published=false`, then `/feed` with `attached_media[]`
- **Video (landscape):** `POST https://graph-video.facebook.com/vXX.0/{page-id}/videos` multipart `source`, `description`, `title`. For big files, use the resumable `upload_phase=start/transfer/finish` flow
- **Reel:** `POST /{page-id}/video_reels upload_phase=start` → upload bytes to `rupload.facebook.com/video-upload/vXX.0/{video_id}` (headers `offset`, `file_size`) → `upload_phase=finish&video_state=PUBLISHED&description=...` → poll `GET /{video_id}?fields=status`
- URL: `https://www.facebook.com/{post_id}` (for reels: `https://www.facebook.com/reel/{video_id}`)

### 4.3 Instagram adapter
Uses the Page token and the IG user ID. **Needs a public media URL** (tunnel) for images. Videos can use the resumable upload instead.
- **Image:** `POST /{ig-user-id}/media` `image_url=<public url>&caption=...` → `creation_id` → `POST /{ig-user-id}/media_publish creation_id=...`
- **Carousel:** a child container per item (`is_carousel_item=true`) → parent `media_type=CAROUSEL&children=id1,id2…&caption` → publish
- **Reel / video:** `POST /{ig-user-id}/media` `media_type=REELS&video_url=<public url>&caption=...&share_to_feed=true` (or `upload_type=resumable` and push the bytes to `rupload.facebook.com`) → **poll** `GET /{container-id}?fields=status_code` every 5 to 10s until `FINISHED` (`ERROR`/`EXPIRED` = failed, 10 min timeout) → `media_publish`
- After publishing: `GET /{media-id}?fields=permalink` → `external_url`
- Check the publishing quota with `GET /{ig-user-id}/content_publishing_limit` before publishing (rolling 24h limit)

### 4.4 YouTube adapter
Uses the `googleapis` SDK with an OAuth2 client (it auto-refreshes the access token using the stored refresh token, so listen to the `tokens` event and save new tokens).
- `youtube.videos.insert({ part: ['snippet','status'], requestBody: { snippet: { title, description, tags, categoryId }, status: { privacyStatus, selfDeclaredMadeForKids: false } }, media: { body: fs.createReadStream(path) } })`. The SDK runs a resumable upload, and `onUploadProgress` drives the progress bar.
- **Shorts:** the video must be vertical/square and ≤ 3 min. Add `#Shorts` to the title or description. There's no special API flag.
- Optional: `thumbnails.set` (needs a verified channel)
- URL: `https://www.youtube.com/watch?v={id}` (Shorts: `https://www.youtube.com/shorts/{id}`)
- **Quota:** `videos.insert` costs ~1,600 of the 10,000 daily units, so about **6 uploads/day**. Show an error message when the quota is exceeded instead of retrying.
- Until the API audit passes, **force `privacyStatus: private`** and show a notice in the UI.

### Done when
- One post of each type (text, image, landscape video, vertical reel) goes out to every supported platform
- Each target shows a working link to the live post
- Killing the server mid-upload and restarting resumes or retries correctly
- A forced failure (e.g. a revoked token) shows a clear error and doesn't block the other platforms

---

## Phase 5: History, retry, dashboard

### Tasks
1. `GET /api/posts?page=&status=&platform=`: paginated list
2. `GET /api/posts/:id`: post + media + targets + recent logs
3. `POST /api/posts/:id/targets/:platform/retry`: reset to `pending`, `attempts=0`
4. `DELETE /api/posts/:id`: delete locally (option: also delete from the platforms where the API allows it. LinkedIn, FB and YT can. IG can't delete via the API)
5. **History page:** table of posts with thumbnail, caption snippet, platform status chips (✅ ⏳ ❌ ⏭) and links
6. **Post detail page:** per-platform timeline from `activity_logs`, raw error toggle, Retry button
7. Media cleanup job: delete files from `uploads/` X days after every target is finished (configurable, default 7 days)

### Done when
- You can find any past post, open its live links, and retry a failed platform with one click

---

## Phase 6: Polish (pick what you need)

- [ ] **Scheduling:** `scheduled_at` on posts. The worker only claims targets whose post is due. Calendar or list view in the UI
- [ ] **Token health:** daily check. Banner when LinkedIn is < 7 days from expiry, or any token is invalid. "Reconnect" button
- [ ] **Hashtag / caption templates:** saved snippets you can insert into the composer
- [ ] **Auto-crop / transcode:** ffmpeg presets to produce 9:16 or 4:5 versions, or re-encode unsupported codecs
- [ ] **Webhooks (optional):** see [guides/webhooks.md](guides/webhooks.md). Useful for comment notifications, not needed for publishing
- [ ] **Desktop notification** when a post finishes or fails
- [ ] **Backup:** nightly `mysqldump` of the database

---

## Rough effort estimate (solo, part-time)

| Phase | Estimate |
|---|---|
| 0 | 1 to 2 evenings + waiting for approvals |
| 1 | 1 day |
| 2 | 2 days |
| 3 | 2 days |
| 4 | 4 to 5 days (Instagram and video processing take the longest) |
| 5 | 1 to 2 days |
| 6 | as needed |
