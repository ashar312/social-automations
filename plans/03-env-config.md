# 03: Environment config (`server/.env`)

`server/.env` is **gitignored**. Commit a copy called `server/.env.example` with every value blanked out.

```dotenv
# ── App ───────────────────────────────────────────
NODE_ENV=development
PORT=5000
HOST=127.0.0.1
CLIENT_URL=http://localhost:5173
SERVER_URL=http://localhost:5000

# Local HTTPS with mkcert (06-local-https.md). Both empty = plain HTTP. Paths relative to server/.
# When set, use https:// in CLIENT_URL, SERVER_URL and the three *_REDIRECT_URI values
# (e.g. CLIENT_URL=https://localhost:5173, SERVER_URL=https://localhost:5000).
TLS_CERT_FILE=../certs/localhost.pem
TLS_KEY_FILE=../certs/localhost-key.pem

# Public HTTPS base URL that points at this server (Cloudflare Tunnel / ngrok)
# Used so Instagram can download media: ${PUBLIC_BASE_URL}/media/<token>/<file>
PUBLIC_BASE_URL=https://your-tunnel.example.com

# 32 random bytes as hex. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY=

UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=4096
# Max PDF size for LinkedIn carousels (LinkedIn limit is 100 MB)
DOC_MAX_MB=100
MEDIA_RETENTION_DAYS=7

# ── MySQL ─────────────────────────────────────────
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=social_automations
DB_USER=root
DB_PASSWORD=ashar312

# ── LinkedIn ──────────────────────────────────────  (guides/linkedin-setup.md)
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=http://localhost:5000/api/oauth/linkedin/callback
LINKEDIN_API_VERSION=202611          # YYYYMM, keep it inside LinkedIn's supported window

# ── YouTube / Google ──────────────────────────────  (guides/youtube-setup.md)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5000/api/oauth/youtube/callback
YOUTUBE_AUDITED=false                # true after the audit passes, which allows public uploads

# ── Meta (Facebook + Instagram) ───────────────────  (guides/meta-instagram-facebook-setup.md)
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=http://localhost:5000/api/oauth/meta/callback
META_GRAPH_VERSION=v24.0             # use the latest version shown in the Meta app dashboard
META_WEBHOOK_VERIFY_TOKEN=           # only if you set up webhooks (optional)
```

## Where each value comes from

| Variable | Source |
|---|---|
| `LINKEDIN_CLIENT_ID/SECRET` | LinkedIn Developer Portal → your app → **Auth** tab |
| `GOOGLE_CLIENT_ID/SECRET` | Google Cloud Console → APIs & Services → **Credentials** → OAuth 2.0 Client |
| `META_APP_ID/SECRET` | developers.facebook.com → your app → **App settings → Basic** |
| `PUBLIC_BASE_URL` | Output of `cloudflared` / `ngrok` (see guides/public-media-url.md) |
| `TOKEN_ENCRYPTION_KEY` | Generate it yourself (command above). **If you lose it, every account has to be reconnected.** |

Access tokens are **not** stored in `.env`. The app gets them through the OAuth "Connect" buttons and saves them encrypted in MySQL.

## Auth and email (plan 08)

`SESSION_DAYS`, `OWNER_PASSWORD` (migration only, then delete), `AUTH_LINKEDIN_ENABLED` / `AUTH_LINKEDIN_REDIRECT_URI`, `AUTH_FACEBOOK_*`, `AUTH_INSTAGRAM_*` (off), `UI_REMOTE_ACCESS` (true lifts the loopback-only rule for UI routes), `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_FROM_NAME`. Placeholders are in `server/.env.example`. Secrets go only in `server/.env`.
