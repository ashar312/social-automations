# 00: Architecture

## 1. High-level flow

```
┌──────────────┐   upload + caption    ┌────────────────────────────┐
│  React app   │ ────────────────────▶ │  Express API (Node)        │
│  (Vite)      │ ◀──── status poll ─── │                            │
└──────────────┘                       │  /uploads (local disk)     │
                                       │  Sequelize ──▶ MySQL       │
                                       │                            │
                                       │  Publisher worker          │
                                       │   ├─ LinkedIn adapter  ────┼──▶ api.linkedin.com
                                       │   ├─ YouTube adapter   ────┼──▶ googleapis.com
                                       │   ├─ Facebook adapter  ────┼──▶ graph.facebook.com
                                       │   └─ Instagram adapter ────┼──▶ graph.facebook.com
                                       └────────────────────────────┘
                                                  ▲
                         public HTTPS tunnel ─────┘  (Instagram downloads media from it)
```

1. You write a post in the **Composer**: a caption, an optional file and the platforms to send it to.
2. The API saves the file to `server/uploads/`, reads its metadata with ffprobe (duration, width/height, size), then creates one `posts` row and one `post_targets` row per platform.
3. The **publisher worker** (a loop inside the server process) picks up `pending` targets and calls the matching **platform adapter**.
4. Each adapter uploads the media, waits for the platform to finish processing, publishes, and stores the external post ID and URL.
5. The UI polls `GET /api/posts/:id` and shows the status for each platform.

There's **no app login**. The server listens on `127.0.0.1` only, so nobody else on your network can reach it.

## 2. Folder layout (to be created in Phase 1)

```
social-automations/
├─ plans/                      ← these docs
├─ server/
│  ├─ src/
│  │  ├─ index.js              ← Express bootstrap
│  │  ├─ config/               ← env loading, sequelize config
│  │  ├─ db/
│  │  │  ├─ models/            ← Sequelize models
│  │  │  ├─ migrations/
│  │  │  └─ seeders/
│  │  ├─ routes/               ← posts, media, connections, oauth
│  │  ├─ services/
│  │  │  ├─ crypto.js          ← AES-256-GCM token encryption
│  │  │  ├─ media.js           ← ffprobe, thumbnails, validation
│  │  │  └─ tokens.js          ← token refresh / expiry checks
│  │  ├─ platforms/
│  │  │  ├─ base.js            ← adapter interface
│  │  │  ├─ linkedin.js
│  │  │  ├─ youtube.js
│  │  │  ├─ facebook.js
│  │  │  └─ instagram.js
│  │  └─ worker/
│  │     └─ publisher.js       ← picks pending targets, runs adapters
│  ├─ uploads/                 ← media files (gitignored)
│  ├─ .sequelizerc
│  ├─ .env                     ← secrets (gitignored)
│  └─ package.json
├─ client/
│  ├─ src/
│  │  ├─ pages/  Composer, History, PostDetail, Connections
│  │  ├─ components/
│  │  └─ api.js
│  ├─ vite.config.js           ← proxies /api → server
│  └─ package.json
└─ .gitignore
```

## 3. Platform adapter interface

All four adapters have the same shape, so the worker doesn't need platform-specific code:

```js
// platforms/base.js (shape only)
{
  name: 'linkedin' | 'youtube' | 'facebook' | 'instagram',
  supports(post)        // → { ok: boolean, reason?: string }   e.g. IG rejects text-only
  validate(post, media) // → string[] of problems (too long, wrong aspect ratio, file too big)
  publish(ctx)          // → { externalId, url }   ctx = { post, target, account, media, log, setProgress }
  refreshToken(account) // → updated account (or throws "reconnect required")
}
```

## 4. Content type × platform matrix

| You upload | LinkedIn (profile) | YouTube | Facebook (Page) | Instagram |
|---|---|---|---|---|
| **Text only** | ✅ text post | ❌ skipped (no API) | ✅ feed post | ❌ skipped (not supported) |
| **Image** (1 to many) | ✅ image / multi-image post | ❌ skipped | ✅ photo post | ✅ image or carousel |
| **Video, landscape** | ✅ video post | ✅ normal video | ✅ Page video | ✅ published as a **Reel** (every IG video is a Reel now) |
| **Reel / vertical ≤ 3 min** | ✅ video post | ✅ **Short** (vertical, ≤ 3 min) | ✅ Page **Reel** | ✅ **Reel** |

In the Composer, any platform that can't take the selected content type is greyed out and shows the reason.

### Per-platform fields (overrides in the Composer)

| Field | Used by |
|---|---|
| Caption / main text | All (LinkedIn max 3,000 chars, IG 2,200, FB long, YT description 5,000) |
| Title | YouTube (required, ≤ 100 chars) |
| Privacy (public / unlisted / private) | YouTube |
| Tags, category | YouTube |
| Thumbnail | YouTube (custom thumbnails need a verified channel), IG Reel cover |
| "Also share Reel to feed" | Instagram |

The default is one caption for everything. Each platform tab can override it.

## 5. Key technical decisions

| Decision | Choice | Why |
|---|---|---|
| Job queue | Use the DB (`post_targets` table) with an in-process polling worker | Single user, low volume, no Redis to run |
| Token storage | Encrypted in MySQL with AES-256-GCM, key in `.env` | Tokens are as sensitive as passwords |
| OAuth | Hand-rolled authorization-code flow per platform | Only 3 providers, so no Passport needed |
| HTTP client | `axios` (+ `googleapis` SDK for YouTube resumable upload) | `googleapis` handles resumable uploads and token refresh |
| File uploads | `multer` to local disk, max ~4 GB | Videos are large, so stream to disk rather than memory |
| Media metadata | `fluent-ffmpeg` + ffprobe binary | Validate duration and aspect ratio before upload |
| Public media URL | Cloudflare Tunnel or ngrok serving `/media/*` | Instagram can only pull media from a public URL |
| Status updates | UI polls every 3s while a post is in progress | Simpler than websockets, and fast enough |
