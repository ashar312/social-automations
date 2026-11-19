# 05: MCP server (let Claude and other AI tools post through a project)

## Goal

Any MCP-capable AI tool (Claude Code, Claude Desktop, claude.ai, Cursor, VS Code Copilot, Windsurf, ChatGPT connectors, n8n's MCP client, the Claude/OpenAI agent SDKs) can use a project's connected LinkedIn, YouTube, Facebook and Instagram accounts as **tools**:

> "Upload this clip, write a caption in our brand voice, post it as a Reel to Instagram and YouTube tomorrow at 9am, and tell me when it's live."

The AI never sees platform tokens. It authenticates with the **same per-project API key** the external API already uses (`sa_live_…`), so everything in [guides/api.md](guides/api.md) (project scoping, `project_mismatch`, archived projects, key rotation) carries over unchanged.

The Integration page already has an **MCP** tab showing "Coming soon" (`client/src/pages/Integration.jsx` → `McpSoon`). This plan replaces it.

## Status (2026-11-19)

- **M1 done:** `services/posts.js` (validate/create/list/get/retry/delete), `services/projects.js` (`projectView`), media ingest/import moved to `services/media.js`; routes are thin wrappers. Migration `20261120000001-media-project-scope` adds `media_files.project_id` and `posts.created_via`. SSRF guard in `services/netGuard.js` (REST too).
- **M2 + M3 done:** `server/src/mcp/` with all section 1.1 tools, annotations, server instructions, rate limits, audit log, Origin check.
- **M4 code done:** `server/bin/mcp-stdio.js` (SDK stdio transport piped to the SDK HTTP client transport; `SA_API_KEY`, `SA_MCP_URL` or `--key`/`--url`; `npm run mcp:stdio`). `upload_media_from_path` tested (allowed dir, outside, `..`, relative, bad extension, missing). Still to do by hand: Claude Desktop, Cursor, VS Code.
- **M5 code done:** Integration → MCP tab (`McpGuide`: key, snippets for Claude Code / Claude Desktop / Cursor / VS Code / Windsurf / Agent SDK / Claude API connector, endpoints, test connection, "AI must schedule" toggle, tool/prompt/resource catalog). Server: `GET /api/projects/:id/mcp` (in-process listing), `POST /api/projects/:id/mcp/test` (real HTTP + key), `mcp/resources.js`, `mcp/prompts.js`, `/api/config` `mcpBridge`/`mcpLocalFiles`, project `settings` now merged on PATCH and accept `mcpPublishNow`. `ViaBadge` in History/PostDetail from `posts.created_via`.
- **Next:** a real publish from a client (M3/M4/M5 "done when"), then M6 (OAuth, optional), M7 (docs).

## Decisions (and why)

| # | Decision | Why |
|---|---|---|
| D1 | **Run the MCP server inside the existing Express server**, not as a separate process | It reuses the DB models, post/media services, worker and env. One thing to start (`npm run dev`). No second port |
| D2 | **Transport: Streamable HTTP** (current MCP spec) at **`/api/v1/mcp`** | Works for every modern client, local or remote. Mounting under `/api/v1` means the existing network guards in `app.js` (loopback guard, tunnel guard, `API_OVER_TUNNEL`) already treat it like the external API. No new exposure rules |
| D3 | **Stateless mode** (no MCP session ids, a fresh server + transport per request) | Nothing the tools do needs session state; long work (publishing) is already tracked in the DB. Stateless survives `nodemon` restarts and needs no session store |
| D4 | **Auth = project API key** as `Authorization: Bearer sa_live_…` (reuse `middleware/apiAuth.js`) | Same key, same scoping, same revoke/rotate UI. One key = one project, so the AI can't post to the wrong brand |
| D5 | **stdio support via a tiny bridge, not a second implementation** | Some clients (older Claude Desktop config, some IDEs) only speak stdio. A ~50-line `bin/` script (or `npx mcp-remote`) forwards stdio ⇄ HTTP. All logic stays in one place |
| D6 | **Tools call service functions, not the HTTP API** | Avoids a loopback HTTP hop. Requires extracting the request-independent logic out of the Express handlers (Phase M1). The v1 routes and the MCP tools then share exactly the same code |
| D7 | **OAuth only for clients that require it** (claude.ai / Claude Desktop "Connectors", ChatGPT), built last (Phase M6) | Claude Code, Cursor, VS Code, Windsurf and the SDKs all accept a static Bearer header. OAuth is only needed for the hosted web UIs and needs a public HTTPS URL anyway |
| D8 | Official SDK **`@modelcontextprotocol/sdk`** (TypeScript SDK, works from CommonJS) | Maintained by the spec authors; handles protocol versions, JSON-RPC, schemas. Pin a recent 1.x; confirm it accepts the project's **zod 4** (recent 1.x does; otherwise pass JSON Schema directly) |
| D9 | Tools have **MCP annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) | Clients use them to decide what to auto-approve. Publishing and deleting are flagged so the user is asked first |

## 1. What the AI gets

### 1.1 Tools

All tools act on the project the key belongs to (no project id argument needed; the server fills it in).

| Tool | Wraps | Annotations | Notes |
|---|---|---|---|
| `get_project` | `GET /me` | read-only | Name, settings (caption footer, hashtags), per-platform connection status. The AI should call this first |
| `get_platform_rules` | `GET /rules` | read-only | Caption limits, video duration/size, what content each platform accepts |
| `upload_media_from_url` | `POST /media` (JSON) | open-world, not read-only | `{ url, name? }` → media `{ id, kind, width, height, duration, suggestedType }` |
| `upload_media_base64` | new, uses `ingest()` | not read-only | `{ filename, data (base64), mimeType }` for small images an AI generated or the user pasted. Cap at `MCP_MAX_INLINE_MB` (default 10) |
| `upload_media_from_path` | new, uses `ingest()` | not read-only | **Off by default.** Only when `MCP_ALLOWED_DIRS` is set and the caller is loopback. Copies a local file (e.g. a rendered video) into uploads. Path must resolve inside an allowed dir (no `..`, symlinks resolved) |
| `validate_post` | `POST /posts/validate` | read-only | Dry run. Same input as `create_post` |
| `create_post` | `POST /posts` | **destructive / open-world** | Publishes publicly (or schedules). Description tells the AI to validate first and confirm with the user |
| `list_posts` | `GET /posts` | read-only | `page`, `limit`, `status`, `platform` |
| `get_post` | `GET /posts/{id}` | read-only | Status per platform, URLs, errors, last N log lines (trim logs to keep responses small) |
| `wait_for_post` | new, polls `get_post` | read-only | Waits until final status or `timeoutSec` (max ~120). Sends MCP **progress notifications** while waiting so clients show progress. Saves the AI from writing its own poll loop |
| `retry_post_target` | `POST /posts/{id}/targets/{platform}/retry` | not read-only, idempotent | |
| `delete_post` | `DELETE /posts/{id}` | **destructive** | `remote: boolean` (also delete on platforms). Description says to confirm with the user |

Tool input schemas are the existing zod `bodySchema` from `services/posts.js` (minus `alsoProjects`), so the MCP and REST validation can never drift. Every tool returns:

- `content`: a short human-readable text summary (what the AI shows the user), and
- `structuredContent` + `outputSchema`: the same JSON as the REST response, for clients that use it.

Errors are returned as tool results with `isError: true` and the API's readable `error` message (and `results` for validation), **not** as protocol errors, so the AI can read them and fix its input.

### 1.2 Resources (read-only context the client can attach)

| URI | Content |
|---|---|
| `social://project` | Same as `get_project` |
| `social://rules` | Platform rules |
| `social://posts/{id}` | Resource template for one post |
| `social://media/{id}/thumb` | Thumbnail image (blob) so a multimodal model can look at uploaded media |

Resources are optional for clients; tools alone are enough. Build them after tools.

### 1.3 Prompts (slash-command style templates in clients that support them)

| Prompt | Args | What it sets up |
|---|---|---|
| `publish_everywhere` | `mediaUrl`, `topic` | get_project → upload → draft per-platform captions using project settings → validate → ask the user to confirm → create → wait → report links |
| `weekly_schedule` | `topic`, `startDate` | Plan and schedule several posts across the week |
| `fix_failed_posts` | — | list failed posts → read errors → retry the ones that can be retried, explain the rest (e.g. "reconnect LinkedIn in the app") |

### 1.4 Server `instructions`

The MCP `initialize` response includes short instructions for the model: call `get_project` first; YouTube needs a title and a video; Instagram has no text posts; media ids are single-use; always `validate_post` and get user confirmation before `create_post`; times need an ISO offset.

## 2. Server changes

### 2.1 New files

```
server/src/mcp/
  index.js        # express router for /api/v1/mcp (auth, origin check, transport per request)
  server.js       # buildMcpServer(project) → McpServer with tools/resources/prompts registered
  tools/
    project.js    # get_project, get_platform_rules
    media.js      # upload_* tools
    posts.js      # validate/create/list/get/wait/retry/delete
  resources.js
  prompts.js
  format.js       # text summaries for tool results
server/bin/
  mcp-stdio.js    # optional stdio ⇄ HTTP bridge (D5)
```

### 2.2 Refactor first (shared service layer, D6)

`routes/posts.js` handlers and `routes/v1.js` helpers are Express `(req, res)` functions. Extract the logic into plain async functions that take `(project, input)` and return data or throw `{ status, message, results }`:

| New function (in `services/`) | Extracted from |
|---|---|
| `projectView(project)` | `v1.js` `projectView` + account lookup |
| `validatePost(project, body)` | `posts.js` `validate` |
| `createPost(project, body)` | `posts.js` `create` + `v1.js` `freeMediaOnly` (API mode: no `alsoProjects`, media must be unattached) |
| `listPosts(project, query)` | `posts.js` `list` |
| `getPost(project, id)` | `posts.js` `detail` + `v1.js` `ownPost` |
| `retryTarget(project, id, platform)` | `posts.js` `retry` + `ownPost` |
| `deletePost(project, id, { remote })` | `posts.js` `remove` + `ownPost` |
| `ingest`, `importFromUrl` | already plain functions in `routes/media.js`; move to `services/media.js` or export as-is |

The Express handlers become thin wrappers. **Done when** the UI and the v1 API behave exactly as before (manual smoke test of Compose, History and the curl examples in `guides/api.md`).

### 2.3 Wiring in `app.js`

- Mount **before** the global `express.json({ limit: '1mb' })`, with its own `express.json({ limit: MCP_MAX_INLINE_MB + overhead })` so base64 uploads fit.
- `app.use('/api/v1/mcp', cors({ exposedHeaders: ['Mcp-Session-Id'] }), require('./mcp'))` — placed before `app.use('/api/v1', …)`.
- `POST` handles JSON-RPC. `GET` and `DELETE` return `405` (stateless mode, no server-initiated stream).
- Respect `MCP_ENABLED` (default `true`); when `false`, the route returns 404.

### 2.4 Request flow

```
AI client ──POST /api/v1/mcp (JSON-RPC)──▶ origin check ─▶ apiAuth (key → req.project)
          ◀── JSON or SSE response ───────  StreamableHTTPServerTransport (stateless)
                                              └─ buildMcpServer(req.project)
                                                   └─ tools → services/* → DB / worker queue
```

Publishing itself is unchanged: `create_post` writes `queued` rows; `worker/publisher.js` picks them up.

### 2.5 Security

- **Key required on every request** (apiAuth). 401 responses include `WWW-Authenticate: Bearer` (and, after M6, the OAuth resource-metadata URL).
- **Origin check** (spec requirement against DNS rebinding): if an `Origin` header is present it must be in `MCP_ALLOWED_ORIGINS` (default empty = reject browser origins; native clients don't send Origin).
- **Media scoping:** verify media ids passed to `create_post` were uploaded through the same project. Today `media_files` has no `project_id`, so a key for project A can attach an unattached upload from project B by guessing its numeric id. Add a nullable `project_id`, set it on upload and check it in `createPost`. This fixes the same gap in the REST API.
- `upload_media_from_url`: block private/loopback/link-local targets (SSRF) since an AI can be prompt-injected into fetching internal URLs. Apply to the REST endpoint too.
- `upload_media_from_path`: off unless `MCP_ALLOWED_DIRS` set; loopback callers only; realpath must be inside an allowed dir; extension allow-list as uploads.
- Destructive tools carry `destructiveHint: true` and descriptions that ask the model to confirm with the user. Optional project setting **"AI must schedule, not publish now"** (`settings.mcpPublishNow = false`) forces `publishNow: false` + a minimum lead time so a human can cancel in History.
- **Audit:** log every MCP tool call to `activity_logs` (or a new `api_calls` table) with tool name, project, post id, client name from `initialize` (`clientInfo.name`). Show "via MCP (Claude Code)" on the post in History.
- Rate limit per key (simple in-memory token bucket, e.g. 60 calls/min, 20 posts/hour, configurable).

### 2.6 New env vars (add to `config/env.js`, `.env.example`, `03-env-config.md`)

| Var | Default | Meaning |
|---|---|---|
| `MCP_ENABLED` | `true` | Turn the MCP endpoint on/off |
| `MCP_ALLOWED_ORIGINS` | *(empty)* | Comma list of browser origins allowed to call `/api/v1/mcp` |
| `MCP_MAX_INLINE_MB` | `10` | Max size for `upload_media_base64` |
| `MCP_ALLOWED_DIRS` | *(empty)* | Folders `upload_media_from_path` may read. Empty = tool not offered |
| `MCP_RATE_PER_MIN` | `60` | Tool calls per minute per key |

Reachability uses the existing settings: local by default, `HOST=0.0.0.0` for LAN, `PUBLIC_BASE_URL` + `API_OVER_TUNNEL=true` for cloud clients.

## 3. Client changes

Replace `McpSoon` in `client/src/pages/Integration.jsx` with an **McpGuide** panel (same building blocks as `ApiGuide`: `Section`, `Code`, `Snippets`, `Copy`, `ApiAccess`):

1. **Endpoint**: local URL and (if enabled) tunnel URL from `/api/config` (add `api.mcpLocal`, `api.mcpTunnel`).
2. **Key**: reuse the `ApiAccess` panel (generate / rotate / revoke).
3. **Copy-paste setup per client** (tabs), pre-filled with the endpoint; key shown as a placeholder unless just generated:
   - Claude Code: `claude mcp add --transport http social-<project> <url> --header "Authorization: Bearer <key>"`
   - Claude Desktop (local): `claude_desktop_config.json` entry using `npx -y mcp-remote <url> --header "Authorization: Bearer ${SA_KEY}"` or `node server/bin/mcp-stdio.js`
   - claude.ai / Claude Desktop Connectors: "Add custom connector" → tunnel URL (needs M6 OAuth)
   - Cursor (`.cursor/mcp.json`), VS Code (`.vscode/mcp.json`), Windsurf: `{ "url": …, "headers": { "Authorization": "Bearer …" } }`
   - ChatGPT (developer mode connector): tunnel URL + OAuth (M6)
   - Agent SDKs (Claude API MCP connector / Agent SDK, OpenAI Agents SDK): code snippet with `url` + `authorization_token`
4. **Test connection** button: server calls its own MCP endpoint (`initialize` + `tools/list`) and shows the tool list.
5. **Tool list** with read-only / destructive badges, and the "AI must schedule, not publish now" toggle (project settings).
6. History/PostDetail: small "via MCP · <client>" badge from the audit log.

## 4. Build phases

Each phase ends with a "done when" check, like `02-phases.md`.

### Phase M1: Service layer refactor
Extract the functions in 2.2; v1 routes and UI routes call them. Add `media_files.project_id` (migration `2026112000000x-media-project-scope.js`).
**Done when** Compose, History, retry, delete and every curl example in `guides/api.md` behave as before, and cross-project media ids are rejected.

### Phase M2: Minimal MCP endpoint (read-only)
Install `@modelcontextprotocol/sdk`. Add `mcp/index.js` (auth, origin check, stateless transport) and the read-only tools `get_project`, `get_platform_rules`, `list_posts`, `get_post`. Server `instructions`.
**Done when** `npx @modelcontextprotocol/inspector` connects to `http://127.0.0.1:5000/api/v1/mcp` with the Bearer key, lists the tools and calls them; a wrong key gives 401; a key of an archived project gives 403.

### Phase M3: Write tools
`upload_media_from_url`, `upload_media_base64`, `validate_post`, `create_post`, `retry_post_target`, `delete_post`, `wait_for_post` (with progress notifications). Annotations. SSRF guard. Audit logging + rate limit.
**Done when** from Claude Code (`claude mcp add …`) you can say "post this image URL to Facebook and LinkedIn with a caption" and the post appears in History, publishes, and the AI reports the live URLs; a validation error is shown to the AI as a readable tool error and it fixes the input.

### Phase M4: stdio bridge + more clients
`server/bin/mcp-stdio.js` (reads `SA_MCP_URL`, `SA_API_KEY`; forwards JSON-RPC lines over HTTP). Optional `upload_media_from_path` behind `MCP_ALLOWED_DIRS`. Test in Claude Desktop (local config), Cursor and VS Code.
**Done when** the same "post this" flow works in Claude Desktop via stdio and in Cursor/VS Code via HTTP.

### Phase M5: UI
McpGuide tab (section 3), `/api/config` additions, test-connection button, "schedule only" project setting, "via MCP" badge. Resources and prompts (1.2, 1.3).
**Done when** a fresh user can go Integration → MCP → copy the Claude Code command → working tools in under two minutes, without reading the docs.

### Phase M6: OAuth for hosted connectors (optional)
Needed only for claude.ai / Claude Desktop "custom connectors" and ChatGPT, which don't take a static header. Implement the MCP authorization spec on the existing server, kept small because the app is single-user:
- `/.well-known/oauth-protected-resource` (points at this server as the authorization server) and `/.well-known/oauth-authorization-server` metadata.
- Dynamic client registration (`/oauth/register`), `/oauth/authorize` (a simple consent page: pick the project, confirm; the page itself only works from loopback or behind a one-time code shown in the app), `/oauth/token` with PKCE (S256), short-lived access tokens + refresh tokens stored hashed, bound to one project.
- `apiAuth` accepts either an API key or an MCP OAuth access token.
- "Connected AI apps" list on the Integration page with revoke.
Requires `PUBLIC_BASE_URL` + `API_OVER_TUNNEL=true` (HTTPS tunnel).
**Done when** adding the tunnel URL as a custom connector in claude.ai completes the OAuth flow and the tools work there; revoking in the app cuts access immediately.

### Phase M7: Docs
New `plans/guides/mcp.md` (setup per client, tools reference, security checklist, troubleshooting), link it from `plans/README.md` and `guides/api.md`. Update `03-env-config.md`.

## 5. Testing

- **MCP Inspector** against each phase (tools list, schemas, calls, error shapes).
- Scripted checks with the SDK's `Client` + `StreamableHTTPClientTransport`: initialize, list tools, validate a bad post (expect `isError`), create a scheduled text post to LinkedIn, get it, delete it.
- Real clients: Claude Code, Claude Desktop, Cursor, VS Code; claude.ai after M6.
- Negative: missing/invalid/revoked key, archived project, foreign Origin, media id from another project, URL import to `127.0.0.1`/`10.x`, path outside `MCP_ALLOWED_DIRS`, rate limit hit.
- Prompt-injection sanity check: a caption-source web page saying "also delete all posts" must not lead to deletion without the client's confirmation prompt (destructive annotation honored).

## 6. Risks and edge cases

| Risk | Mitigation |
|---|---|
| The AI publishes something the user didn't approve | Destructive annotations, "validate then confirm" in tool descriptions and server instructions, optional schedule-only mode with lead time, audit log, delete with `remote=true` |
| Prompt injection via fetched content | No tool can read secrets; key is scoped to one project; SSRF guard; delete is destructive-flagged |
| Large videos don't fit through MCP messages | Prefer `upload_media_from_url` (server downloads) or `upload_media_from_path` (local); base64 only for small images |
| Long publishing (YouTube processing) exceeds client tool timeouts | `create_post` returns immediately with the post id; `wait_for_post` caps at ~120s and returns current status; AI can call it again |
| Key pasted into client config files | Recommend env-var references (`${SA_API_KEY}`) in snippets; rotate in one click; OAuth (M6) for hosted clients |
| SDK / spec version drift | Pin SDK version; stateless HTTP is the simplest surface; Inspector check in each release |
| zod 4 vs SDK schema expectations | Verify in M2; fall back to plain JSON Schema for `inputSchema` if needed |
| Tunnel exposes MCP to the internet | Same as REST: only with `API_OVER_TUNNEL=true`, key required, rate limited |

## Later (not in this plan)

- **Account-level key** that can see several projects, with a `project` argument on each tool (today: one key per project, add the server once per project in the client).
- MCP **elicitation** to ask the user for missing fields (e.g. YouTube title) through the client UI, once client support is common.
- Server-to-client notifications when a post finishes (needs stateful sessions + GET stream).
- Caption-writing helpers that use the project's past posts as style examples (a `get_recent_captions` tool/resource).
- Publishing the stdio bridge as an npm package (`npx social-automations-mcp`).
