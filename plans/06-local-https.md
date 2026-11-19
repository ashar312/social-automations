# Local HTTPS

Run the app on `https://localhost:5173` (UI) and `https://localhost:5000` (API) instead of plain HTTP, with a certificate the browser trusts (no warning page).

## Why

- **Meta OAuth.** Facebook Login enforces HTTPS on redirect URIs and can block logins from `http://` pages ("Insecure Login Blocked"). Today the guide falls back to using the tunnel URL for the callback, which breaks every time a quick tunnel URL changes.
- **Same scheme everywhere.** The OAuth callbacks, the UI and the tunnel can all use `https://`, so the dev setup matches production behaviour (secure context, `Secure` cookies, `crypto.subtle`, clipboard API).
- LinkedIn and Google accept `http://localhost`, so they work either way. They also accept `https://localhost`, so one scheme covers all three.

## Approach

Use **mkcert**. It creates a local certificate authority (CA), installs it in the Windows trust store, and issues a certificate for `localhost`. Both Vite and Express load that same cert/key pair.

Rejected options:

| Option | Why not |
|---|---|
| Self-signed cert (`@vitejs/plugin-basic-ssl`, openssl) | Browser warning every time. OAuth redirects land on an interstitial. |
| Reverse proxy (Caddy / nginx) in front | One more process to run. Caddy's `tls internal` works but adds nothing over mkcert here. |
| Use the tunnel for everything | Slower, URL changes on quick tunnels, and the tunnel must only expose `/media` (and optionally `/api/v1`). |

HTTPS stays **opt-in** through `.env`. With the HTTPS variables empty, everything runs over HTTP exactly as it does now.

## Steps

### 1. One-time machine setup (manual, per PC)

```powershell
winget install FiloSottile.mkcert
mkcert -install                       # installs the local CA in the Windows trust store (one UAC prompt)
mkdir certs
mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1
```

- Add `certs/` to `.gitignore`. Never commit the key. Never share `rootCA-key.pem` (from `mkcert -CAROOT`): anyone with it can impersonate any site on this PC.
- Chrome and Edge use the Windows store, so they trust the cert at once. Firefox: set `security.enterprise_roots.enabled = true` in `about:config` if it shows a warning.
- For LAN access (`HOST=0.0.0.0`), add the PC's LAN IP to the `mkcert` command. Other machines must also trust the CA (copy `rootCA.pem` to them and import it), or they get warnings.
- The cert lasts about 2 years and 3 months. Re-run the `mkcert` line when it expires.

### 2. Env config (`server/.env`, `.env.example`, `config/env.js`)

New variables:

```ini
# Local HTTPS (plans/06-local-https.md). Both empty = plain HTTP.
TLS_CERT_FILE=../certs/localhost.pem
TLS_KEY_FILE=../certs/localhost-key.pem
```

- Paths are resolved relative to `server/`, like `UPLOAD_DIR`.
- In `env.js`, add both as optional strings and validate: either both set or both empty, and both files exist (fail at startup with a clear message instead of crashing in `https.createServer`).
- Expose `env.HTTPS = !!(TLS_CERT_FILE && TLS_KEY_FILE)`.

Update the URL values when HTTPS is on:

```ini
CLIENT_URL=https://localhost:5173
SERVER_URL=https://localhost:5000
LINKEDIN_REDIRECT_URI=https://localhost:5000/api/oauth/linkedin/callback
GOOGLE_REDIRECT_URI=https://localhost:5000/api/oauth/youtube/callback
META_REDIRECT_URI=https://localhost:5000/api/oauth/meta/callback
```

Add a startup warning when `env.HTTPS` is true but `SERVER_URL`, `CLIENT_URL` or a redirect URI still starts with `http://` (the most likely mistake).

### 3. Express server (`server/src/server.js`)

- When `env.HTTPS`: `https.createServer({ cert, key }, app).listen(PORT, HOST)`. Otherwise keep `app.listen`.
- `https.Server.listen` does **not** pass errors to its callback like Express 5's `app.listen` does. Add a `server.on('error', ...)` handler so `EADDRINUSE` still exits before the worker starts.
- Keep `requestTimeout = 0` and `headersTimeout` on whichever server is created.
- Log `https://` or `http://` correctly in the "listening" line.
- Do **not** set HSTS. On `localhost` it sticks in the browser for every port and breaks other local projects that use HTTP.

No changes needed in `app.js`:
- The loopback guard reads `req.socket.remoteAddress`, which is the same over TLS.
- CORS reads `CLIENT_URL`, which now has the `https://` origin.
- The tunnel `Host` check is unchanged.

### 4. Vite dev server (`client/vite.config.js`)

- Read the same cert/key and set `server.https = { cert, key }` when the files exist. Read the paths from `server/.env` (via Vite's `loadEnv` on `../server`) or from `client/.env` (`VITE_` prefix not needed for config-only vars), so there is one source of truth.
- Switch the proxy targets to `https://127.0.0.1:5000` when HTTPS is on.
- The proxy runs in Node, which does not read the Windows trust store by default. Either:
  - **recommended:** start Vite with `NODE_OPTIONS=--use-system-ca` (supported on the installed Node 24), so it trusts the mkcert CA, or
  - set `secure: false` on the proxy entries. This is acceptable because the target is loopback, but it hides real cert problems.
- Leave `server.host` as is (localhost only).

### 5. Node clients that call the server over HTTPS

These run in Node and also need to trust the mkcert CA:

| Caller | File | Change |
|---|---|---|
| MCP "Test connection" | `server/src/mcp/selfTest.js` | Build the URL from `env.HTTPS` (`https://localhost:PORT` instead of the hard-coded `http://127.0.0.1`). The cert covers `127.0.0.1` too, so either host works. |
| stdio bridge | `server/bin/mcp-stdio.js` | Keep the default URL, but document `SA_MCP_URL=https://127.0.0.1:5000/api/v1/mcp` and `NODE_OPTIONS=--use-system-ca` for HTTPS setups. Improve `reason()` to explain `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN` errors ("Node doesn't trust the local cert: set NODE_OPTIONS=--use-system-ca"). |
| Server process itself | `server/package.json` | Add `--use-system-ca` to the `dev` and `start` scripts so `selfTest` trusts the cert. |

Native MCP clients (Claude Desktop, VS Code, Cursor) that connect directly to `https://localhost:5000/api/v1/mcp` use their own trust settings. Most Electron apps read the Windows store and will work. If one doesn't, point it at the stdio bridge instead.

### 6. UI text and fallbacks (`client/src/pages/Integration.jsx`)

- Fallback URLs `http://localhost:5000/api/v1/mcp` and `http://127.0.0.1:5000/api/v1` are only used before `/api/config` loads. Leave them, or derive them from `window.location.protocol`.
- The "Another machine on your network" rows show `http://<this-PC-IP>:5000`. Use the scheme of `cfg.localBase` instead of hard-coding `http`.
- Optionally add `https: env.HTTPS` to `/api/config` so the UI can show an "HTTPS on" pill.

### 7. Tunnel (`plans/guides/public-media-url.md`)

The tunnel must now reach an HTTPS origin:

```powershell
cloudflared tunnel --url https://localhost:5000 --no-tls-verify
ngrok http https://localhost:5000
```

`--no-tls-verify` is fine because cloudflared connects over loopback. `PUBLIC_BASE_URL` does not change. It was already `https://` on the tunnel side.

### 8. Platform consoles (manual)

Add the new `https://localhost:5000/api/oauth/<platform>/callback` redirect URI in each console. Keep the old `http://` one until the switch is confirmed, then remove it.

- **LinkedIn:** Developer portal → app → Auth → Authorized redirect URLs.
- **Google:** Cloud Console → APIs & Services → Credentials → OAuth client → Authorized redirect URIs.
- **Meta:** App → Facebook Login → Settings → Valid OAuth Redirect URIs. Turn on "Enforce HTTPS" and "Use Strict Mode" now that the redirect is HTTPS.

Existing tokens stay valid. The redirect URI only matters during the connect flow.

### 9. Docs

- `plans/03-env-config.md`: add `TLS_CERT_FILE` / `TLS_KEY_FILE`, plus the HTTPS variants of the URL values.
- `plans/guides/*-setup.md`: mention the `https://localhost` redirect URI as the preferred value.
- `plans/guides/meta-instagram-facebook-setup.md`: replace "if Meta rejects the http URL, use the tunnel" with "use HTTPS localhost (06-local-https.md)".
- `plans/README.md`: add this file to the documents table.

## Done when

- [ ] `npm run dev` opens `https://localhost:5173` with a padlock and no warning, in Chrome/Edge.
- [ ] `https://localhost:5000/api/health` loads directly in the browser.
- [ ] API calls from the UI go through the Vite proxy over HTTPS (no `ECONNRESET` or cert errors in the Vite log).
- [ ] Connecting LinkedIn, YouTube and Meta completes and returns to `https://localhost:5173/connections`.
- [ ] Integration page → MCP "Test connection" succeeds.
- [ ] The stdio bridge works with `SA_MCP_URL=https://127.0.0.1:5000/api/v1/mcp`.
- [ ] Instagram image post works through the tunnel pointed at the HTTPS origin.
- [ ] Clearing `TLS_CERT_FILE` / `TLS_KEY_FILE` (and reverting the URLs) brings back plain HTTP with no other changes.
- [ ] Starting with a missing cert file prints a clear error and exits.

## Risks

| Risk | Mitigation |
|---|---|
| Node processes (Vite proxy, selfTest, stdio bridge) reject the mkcert cert | `--use-system-ca`, with a readable error message when it's missing |
| An MCP client app doesn't trust the local CA | Use the stdio bridge, which runs in Node with `--use-system-ca` |
| Forgetting to update a redirect URI in one console | Keep both URIs registered during the switch. The startup warning catches `.env` mismatches |
| CA key leak | `certs/` is gitignored. The CA key stays in mkcert's `CAROOT`, outside the repo |
