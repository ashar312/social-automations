# External API: let other systems post through this app

Other programs (scripts, n8n, Zapier, a CMS, a cron job, another backend) can publish through the connections you already set up in the app. They never see the LinkedIn / YouTube / Meta tokens; they only get a **project ID** and that project's **API key**.

```
Your system ──HTTP──▶ /api/v1/projects/prj_f81068c1c52f041a/posts
                      Authorization: Bearer sa_live_…
                              │
                              ▼
               Project "Xavia"  ──▶ its LinkedIn, YouTube, Facebook, Instagram
```

## 1. How a call finds the right project and accounts

| Piece | Looks like | What it does |
|---|---|---|
| **Project ID** | `prj_f81068c1c52f041a` | Unique per project, created automatically, never changes. Goes in the URL |
| **API key** | `sa_live_J-ph…` (40+ chars) | Secret, one per project. Goes in the `Authorization` header |
| **Platform** | `linkedin`, `youtube`, `facebook`, `instagram` | Picks the account *inside* that project (a project has at most one per platform) |

Rules:

- The key belongs to exactly one project. If the URL names a different project you get **403 `project_mismatch`**. This stops a script from posting to the wrong brand by mistake.
- The account used for each platform is the one connected in that project in the app (Connections page). Reconnecting an account in the app does **not** change the project ID or key.
- An archived project rejects calls (**403 `project_archived`**).
- Only a SHA-256 hash of the key is stored. Lost keys can't be recovered; generate a new one.

## 2. Get the project ID and API key

1. Open the app → **Projects**.
2. On the project's card, under **API access**:
   - **Project ID**: click *Copy*.
   - Click **Generate API key** and copy it right away. It is shown **once**.
3. **New key** replaces the old one (the old key stops working immediately). **Revoke** removes it.
4. The card shows when the key was created and last used.

Store the key like a password (env var / secret store), never in front-end code or a public repo.

## 3. Where the API is reachable

Base URL: `http://127.0.0.1:5000/api/v1` (the server's `PORT`).

| Caller | Setup |
|---|---|
| Same computer | Nothing to do. Use `http://127.0.0.1:5000/api/v1` |
| Another machine on your network | In `server/.env` set `HOST=0.0.0.0`, restart, use `http://<this-PC-IP>:5000/api/v1`. Allow port 5000 in Windows Firewall. Only `/api/v1/*` and `/media/*` answer non-local callers; the app's own UI API stays local-only because it has no login |
| A cloud service (Zapier, n8n cloud, a hosted backend) | Use the HTTPS tunnel from [public-media-url.md](public-media-url.md) and set `API_OVER_TUNNEL=true` in `server/.env`. Base URL becomes `https://<tunnel-host>/api/v1` |

The **server must be running** (`npm run dev` or `npm start --prefix server`): posts are published by its background worker.

## 4. Authentication

Send the key on every request, either way:

```
Authorization: Bearer sa_live_xxxxxxxxxxxxxxxx
X-API-Key: sa_live_xxxxxxxxxxxxxxxx
```

CORS is open on `/api/v1`, so a browser can call it too, but that exposes the key to whoever uses the page. Prefer server-side calls.

## 5. Endpoints

All responses are JSON with `ok: true|false`. Errors also have `error` (a readable message) and, for auth errors, `code`.

`{pid}` below = your project ID.

| Method | Path | What it does |
|---|---|---|
| GET | `/me` | Which project this key belongs to, plus its connections. Handy to discover the project ID |
| GET | `/rules` | Platform limits (caption length, video duration, size). No key needed |
| GET | `/projects/{pid}` | Project info + connection status per platform |
| POST | `/projects/{pid}/media` | Upload a file, or import one from a URL → returns a media `id` |
| POST | `/projects/{pid}/posts/validate` | Dry run: checks a post against each platform, creates nothing |
| POST | `/projects/{pid}/posts` | Create the post (publish now or schedule) |
| GET | `/projects/{pid}/posts` | List posts (`?page=1&limit=20&status=failed&platform=youtube`) |
| GET | `/projects/{pid}/posts/{id}` | One post with per-platform status, URLs, errors and the activity log |
| POST | `/projects/{pid}/posts/{id}/targets/{platform}/retry` | Retry one failed platform |
| DELETE | `/projects/{pid}/posts/{id}` | Delete from history. Add `?remote=true` to also delete it on the platforms that allow it |

### 5.1 `GET /me` and `GET /projects/{pid}`

```json
{
  "ok": true,
  "project": {
    "id": "prj_f81068c1c52f041a",
    "name": "Xavia",
    "settings": { "captionFooter": "…", "hashtags": "#xavia" },
    "connections": [
      { "platform": "linkedin",  "connected": true, "status": "connected", "accountName": "Techaract", "accountId": "urn:li:organization:71181886", "expiresAt": "2027-01-18T08:32:34.000Z" },
      { "platform": "youtube",   "connected": true, "status": "connected", "accountName": "My Channel", "accountId": "UC…", "expiresAt": null },
      { "platform": "facebook",  "connected": false },
      { "platform": "instagram", "connected": true, "status": "connected", "accountName": "mybrand", "accountId": "1784…", "expiresAt": null }
    ]
  }
}
```

`status` is `connected`, `error` or `expired`. Expired accounts must be reconnected in the app.

### 5.2 Upload media: `POST /projects/{pid}/media`

Two ways. Both return the same body.

**a) File upload** (`multipart/form-data`, field name `file`):

```bash
curl -X POST http://127.0.0.1:5000/api/v1/projects/$PID/media \
  -H "Authorization: Bearer $KEY" \
  -F "file=@./clip.mp4"
```

**b) From a URL** (JSON). The server downloads it:

```bash
curl -X POST http://127.0.0.1:5000/api/v1/projects/$PID/media \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/files/clip.mp4", "name": "clip.mp4"}'
```

Response:

```json
{ "ok": true, "id": 42, "kind": "video", "name": "clip.mp4", "width": 1080, "height": 1920,
  "duration": 31.5, "size": 8123456, "mime": "video/mp4", "suggestedType": "reel" }
```

- Types: jpg, png, webp (converted to jpg), mp4, mov, pdf. Max size = `MAX_UPLOAD_MB` (PDFs: `DOC_MAX_MB`, default 100). A PDF comes back as `kind: "document"` with `pageCount` and `suggestedType: "document"`. Password-protected PDFs are rejected.
- `suggestedType` is a hint for `contentType` below.
- A media id can be used in **one** post. Upload again for another post.

**c) Build a LinkedIn PDF carousel from images**: `POST /projects/{pid}/media/carousel`. Upload 2 to 20 images first, then:

```bash
curl -X POST http://127.0.0.1:5000/api/v1/projects/$PID/media/carousel \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"mediaIds": [42, 43, 44], "size": "1080x1350", "fit": "contain", "background": "#ffffff", "name": "launch.pdf"}'
```

One image = one page. `size`: `1080x1350` (4:5, default), `1080x1080` or `1920x1080`. `fit`: `contain` (letterbox onto `background`) or `cover` (crop from the center). Returns the new PDF media (same shape as above). The image ids are used up.

### 5.3 Create a post: `POST /projects/{pid}/posts`

```json
{
  "contentType": "reel",
  "caption": "Launch day! 🚀",
  "title": "Our launch in 30 seconds",
  "mediaIds": [42],
  "targets": [
    { "platform": "instagram" },
    { "platform": "facebook" },
    { "platform": "youtube", "overrides": { "privacy": "public", "tags": ["launch", "startup"] } },
    { "platform": "linkedin", "overrides": { "caption": "We launched today. Here is the 30 second version." } }
  ],
  "publishNow": true
}
```

| Field | Type | Notes |
|---|---|---|
| `contentType` | `text` \| `image` \| `video` \| `reel` \| `document` | Required. `reel` = vertical short video (Reels / Shorts). `document` = PDF carousel: LinkedIn only, exactly one PDF media id, needs a `title` |
| `caption` | string | Post text / video description. The project's caption footer and hashtags (Projects → Edit) are added automatically |
| `title` | string | Needed for YouTube, and for LinkedIn PDF carousels (shown above the slides, max 400) |
| `mediaIds` | number[] | From the upload step, in display order. Images: several for a carousel where supported |
| `targets` | array, min 1 | Platforms to post to, each `{ platform, overrides? }` |
| `publishNow` | boolean | Default `true` |
| `scheduledAt` | ISO 8601 with offset | Used when `publishNow` is `false`, e.g. `"2026-11-25T09:00:00+05:00"` |

**`overrides`** (per platform, all optional):

| Key | Platforms | Meaning |
|---|---|---|
| `caption` | all | Replaces the main caption for this platform |
| `title` | youtube | Replaces the main title |
| `privacy` | youtube | `public`, `unlisted`, `private`. Forced to `private` until your YouTube API audit passes (`YOUTUBE_AUDITED=true`) |
| `tags` | youtube | Array or comma-separated string |
| `categoryId` | youtube | YouTube category id (default `22`) |
| `shareToFeed` | instagram | `false` = Reel only in the Reels tab |

What each platform accepts (same rules as the Compose page):

| | text | image | video | reel |
|---|---|---|---|---|
| LinkedIn | ✅ | ✅ | ✅ | ✅ |
| YouTube | ❌ | ❌ | ✅ | ✅ (Short) |
| Facebook | ✅ | ✅ | ✅ | ✅ |
| Instagram | ❌ | ✅ | ✅ | ✅ |

Platforms that don't support the content type are **skipped** (not an error) as long as at least one target is supported. Instagram also needs `PUBLIC_BASE_URL` set.

Responses:

- **201** `{ "ok": true, "id": 123, "status": "queued", "also": [] }`. The worker picks it up within seconds.
- **400** `{ "ok": false, "error": "Fix the validation errors first", "results": { "youtube": { "supported": true, "errors": ["YouTube needs a title"], "warnings": [] } } }`
- **400** when no target supports the content, a platform is not connected in this project, or a media id is unknown / already used.

`alsoProjects` (cross-posting) is not available through the API. To post to several projects, call each project with its own key.

### 5.4 Dry run: `POST /projects/{pid}/posts/validate`

Same body as create. Nothing is saved.

```json
{ "ok": true, "results": {
  "facebook": { "supported": true,  "reason": null, "errors": [], "warnings": [] },
  "youtube":  { "supported": false, "reason": "YouTube needs a video (no text or image posts through the API)", "errors": [], "warnings": [] }
} }
```

### 5.5 Track a post: `GET /projects/{pid}/posts/{id}`

Poll every 10 to 30 seconds until `status` is final.

```json
{ "ok": true, "post": {
  "id": 123, "status": "partial", "contentType": "reel", "caption": "…", "scheduledAt": null,
  "targets": [
    { "platform": "instagram", "status": "published", "externalUrl": "https://www.instagram.com/reel/…", "errorMessage": null },
    { "platform": "youtube",   "status": "failed", "errorMessage": "…", "attempts": 3 }
  ],
  "logs": [ { "level": "info", "message": "Uploading Reel (resumable)", "createdAt": "…" } ]
} }
```

| Post `status` | Meaning |
|---|---|
| `queued` | Waiting (or scheduled for later) |
| `publishing` | At least one platform still working |
| `completed` | Every supported platform published |
| `partial` | Some published, some failed |
| `failed` | None published |

Target `status`: `pending` → `uploading` → `processing` → `published` / `failed`, or `skipped` (platform doesn't support the content).

Temporary errors (timeouts, rate limits) are retried automatically, up to 3 attempts. After that, call **retry** (5.6) or fix the cause (often: reconnect the account in the app).

### 5.6 Retry and delete

```bash
curl -X POST   "$BASE/projects/$PID/posts/123/targets/youtube/retry" -H "Authorization: Bearer $KEY"
curl -X DELETE "$BASE/projects/$PID/posts/123?remote=true"            -H "Authorization: Bearer $KEY"
```

Delete returns `{ "ok": true, "remote": [ { "platform": "facebook", "ok": true } ] }`. Platforms whose API can't delete report `ok: false` with a reason.

## 6. Errors

| HTTP | `code` | Cause / fix |
|---|---|---|
| 401 | `missing_api_key` | No `Authorization` / `X-API-Key` header |
| 401 | `invalid_api_key` | Wrong, replaced or revoked key. Generate a new one in Projects |
| 403 | `project_mismatch` | The key belongs to another project than the one in the URL |
| 403 | `project_archived` | Restore the project in the app |
| 400 | – | Validation problem; read `error` (and `results` on posts) |
| 404 | – | Unknown route, or the post is not in this project |
| 413 | – | File larger than `MAX_UPLOAD_MB` |
| 500 | – | Server error; see the server console |

## 7. Full examples

### Bash / curl

```bash
BASE=http://127.0.0.1:5000/api/v1
PID=prj_f81068c1c52f041a
KEY=sa_live_xxxxxxxx

# 1. upload
MEDIA_ID=$(curl -s -X POST "$BASE/projects/$PID/media" -H "Authorization: Bearer $KEY" -F "file=@./photo.jpg" | jq .id)

# 2. post
curl -s -X POST "$BASE/projects/$PID/posts" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"contentType\":\"image\",\"caption\":\"Hello from the API\",\"mediaIds\":[$MEDIA_ID],\"targets\":[{\"platform\":\"facebook\"},{\"platform\":\"instagram\"},{\"platform\":\"linkedin\"}]}"
```

### Node.js (18+)

```js
const BASE = 'http://127.0.0.1:5000/api/v1'
const PID = process.env.SA_PROJECT_ID
const auth = { Authorization: `Bearer ${process.env.SA_API_KEY}` }

async function call(path, init = {}) {
  const res = await fetch(`${BASE}/projects/${PID}${path}`, { ...init, headers: { ...auth, ...init.headers } })
  const data = await res.json()
  if (!data.ok) throw new Error(`${res.status}: ${data.error}`)
  return data
}

const media = await call('/media', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com/clip.mp4' }),
})
const { id } = await call('/posts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contentType: media.suggestedType, caption: 'New video', title: 'New video',
    mediaIds: [media.id], targets: [{ platform: 'youtube' }, { platform: 'instagram' }],
  }),
})
let post
do {
  await new Promise((r) => setTimeout(r, 15000))
  post = (await call(`/posts/${id}`)).post
} while (['queued', 'publishing'].includes(post.status))
console.log(post.status, post.targets.map((t) => `${t.platform}: ${t.externalUrl || t.errorMessage}`))
```

### Python

```python
import os, time, requests

BASE = "http://127.0.0.1:5000/api/v1"
PID = os.environ["SA_PROJECT_ID"]
H = {"Authorization": f"Bearer {os.environ['SA_API_KEY']}"}

with open("photo.jpg", "rb") as f:
    media = requests.post(f"{BASE}/projects/{PID}/media", headers=H, files={"file": f}).json()

r = requests.post(f"{BASE}/projects/{PID}/posts", headers=H, json={
    "contentType": "image",
    "caption": "Hello from Python",
    "mediaIds": [media["id"]],
    "targets": [{"platform": "facebook"}, {"platform": "instagram"}],
    "publishNow": False,
    "scheduledAt": "2026-11-25T09:00:00+05:00",
}).json()
print(r)
```

### n8n / Zapier

Use an **HTTP Request** step:

- Method `POST`, URL `https://<tunnel-host>/api/v1/projects/<project id>/posts`
- Header `Authorization` = `Bearer <key>` (store it as a credential)
- Body = JSON from 5.3. For media, first call `/media` with `{ "url": "<file url from the previous step>" }` and pass `{{ id }}` into `mediaIds`.

## 8. Security checklist

- One key per project; give each external system only the key of the project it should post to.
- Rotate (**New key**) if a key leaks; the old one stops working at once.
- Keep `HOST=127.0.0.1` unless another machine really needs access.
- `API_OVER_TUNNEL=true` puts the API on the internet: anyone with the key can post. Turn it off when not needed.

## 9. How it is built (for maintainers)

| Part | File |
|---|---|
| Columns `public_id`, `api_key_hash`, `api_key_hint`, `api_key_created_at`, `api_key_last_used_at` on `projects` | `server/src/db/migrations/20261119000005-add-project-api.js` |
| Key generation / hashing | `server/src/services/apiKeys.js` |
| Auth middleware (key → project, URL id must match) | `server/src/middleware/apiAuth.js` |
| `/api/v1` routes (reuse the app's media and post handlers) | `server/src/routes/v1.js` |
| Generate / revoke key (UI API) | `POST` / `DELETE /api/projects/:id/api-key` in `server/src/routes/projects.js` |
| Network guard + `API_OVER_TUNNEL` | `server/src/app.js` |
| UI panel | `client/src/projects/ApiAccess.jsx` on the Projects page |
