# 04: Projects (group connections per channel/brand)

## Goal

Today the app holds **one account per platform** (`platform_accounts.platform` is UNIQUE). That works for one brand only.

After this change:

1. You **create or select a Project** first (for example "Personal", "Xavia Solutions", "Gaming channel").
2. Each project has **its own set of connections**: its own LinkedIn, YouTube channel, Facebook Page and Instagram account.
3. Compose, History, Connections and token alerts all work **inside the active project**.
4. The tool is still single-user and runs on localhost. There are no logins.

```
Project "Personal"          Project "Xavia"            Project "Gaming"
 ├─ LinkedIn (me)            ├─ Facebook Page "Xavia"   ├─ YouTube "MyGames"
 ├─ YouTube "Ashar Vlogs"    ├─ Instagram @xavia        └─ Instagram @mygames
 └─ Instagram @ashar         └─ LinkedIn (me)  ← same profile, reused
```

## Decisions (and why)

| Decision | Choice | Why |
|---|---|---|
| Name | **Project** (table `projects`) | Matches how you described it; "App" clashes with the Meta/LinkedIn/Google "app" (OAuth client) |
| Platforms per project | Still **max one account per platform per project** | Keeps Compose simple (tick a platform, not an account). Want two IG accounts? Make two projects |
| OAuth apps (client ID/secret) | **Shared**, stay in `server/.env` | One Meta app / Google client / LinkedIn app can authorize many accounts. No need for per-project credentials |
| Same account in two projects | **Allowed** (e.g. your LinkedIn profile in every project) | Each project gets its own row; when one row's token is refreshed, copy it to sibling rows with the same `platform + external_id` (see "Shared accounts") |
| Which account a post uses | Stored on the target: `post_targets.platform_account_id` | Retry, remote delete and the worker use the exact account the post was queued for, even if you switch projects |
| Active project in the UI | React context + `localStorage`, switcher in the header | Short URLs stay the same (`/compose`, `/history`); no router rewrite |
| API shape | Project-scoped routes: `/api/projects/:projectId/...` | Explicit; no hidden header; easy to test with curl |
| XP / levels / streak | **Global** (they track *you*) | History and Compose are per project; the game stays one player |
| Deleting a project | **Archive** by default; hard delete only if it has no posts | Never lose post history by accident |

## 1. Database

### New table `projects`

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| name | VARCHAR(100) | UNIQUE |
| color | VARCHAR(16) | Hex accent shown in the switcher, e.g. `#7c5cff` |
| icon | VARCHAR(32) NULL | Emoji or icon key |
| description | VARCHAR(500) NULL | |
| archived_at | DATETIME NULL | NULL = active |
| created_at / updated_at | DATETIME | |

### Changes to existing tables

| Table | Change |
|---|---|
| `platform_accounts` | Add `project_id INT NOT NULL FK → projects.id ON DELETE CASCADE`. **Drop** UNIQUE(`platform`), **add** UNIQUE(`project_id`, `platform`). Add INDEX(`platform`, `external_id`) for sibling lookups |
| `posts` | Add `project_id INT NOT NULL FK → projects.id ON DELETE RESTRICT`, INDEX(`project_id`, `id`) |
| `post_targets` | Add `platform_account_id INT NULL FK → platform_accounts.id ON DELETE SET NULL` (snapshot of the account used) |
| `oauth_states` | Add `project_id INT NULL` (which project the OAuth flow is connecting into) |
| `media_files` | No change. Media belongs to a post, and the post belongs to a project |
| `activity_logs` | No change |

### Migrations (new files in `server/src/db/migrations/`)

1. `20261119000001-create-projects.js`: create `projects`.
2. `20261119000002-add-project-scope.js`, in one transaction:
   - Insert a **"Default"** project.
   - Add the `project_id` columns as **NULL**, backfill every existing `platform_accounts` / `posts` row with the Default project's id, then change them to **NOT NULL** and add the FKs.
   - Drop the old unique index on `platform_accounts.platform` (look up its real name first with `SHOW INDEX FROM platform_accounts`; it is probably `platform`), add `platform_accounts_project_platform_uq`.
   - Add `post_targets.platform_account_id` and backfill it with `UPDATE post_targets t JOIN posts p … JOIN platform_accounts a ON a.project_id = p.project_id AND a.platform = t.platform`.
   - Add `oauth_states.project_id`.
   - `down()` reverses this. It only works while each platform has one account; say so in a comment.
3. Run the nightly backup (`services/backup.js`) by hand **before** migrating.

### Models

- New `server/src/db/models/Project.js`; register it in `models/index.js`.
- Associations:
  - `Project.hasMany(PlatformAccount, as 'accounts')`, `PlatformAccount.belongsTo(Project)`
  - `Project.hasMany(Post, as 'posts')`, `Post.belongsTo(Project)`
  - `PostTarget.belongsTo(PlatformAccount, as 'account')`
- `PlatformAccount.js`: remove `unique: true` from `platform`, add `project_id`.
- Update `plans/01-database.md` with the new table and columns.

## 2. Server API

### New: `server/src/routes/projects.js`

| Method | Route | Does |
|---|---|---|
| GET | `/api/projects` | List projects (`?archived=true` includes archived) with a summary: connected count, post count, worst token status |
| POST | `/api/projects` | Create `{ name, color?, icon?, description? }` (validate with zod; name 1–100 chars, unique) |
| PATCH | `/api/projects/:projectId` | Rename / recolor / archive (`archived: true/false`) |
| DELETE | `/api/projects/:projectId` | Hard delete; **409** if it has posts (archive instead). Cascades its connections |

Add a `loadProject` middleware (`router.param('projectId', …)`) that 404s on unknown ids and sets `req.project`. Add `patch` to `client/src/api.js`.

### Scoped existing routes

Mount them under the project; keep everything else the same.

| Before | After |
|---|---|
| `GET /api/connections` | `GET /api/projects/:projectId/connections` |
| `POST /api/connections/:platform/test` | `POST /api/projects/:projectId/connections/:platform/test` |
| `DELETE /api/connections/:platform` | `DELETE /api/projects/:projectId/connections/:platform` |
| `POST /api/posts`, `/validate`, `GET /api/posts` | `/api/projects/:projectId/posts…` |
| `GET /api/posts/:id`, retry, delete | **Keep global** (`/api/posts/:id`) and return `projectId` in the response, so links from alerts/history always work |
| — | `GET /api/connections/alerts` (global): accounts needing attention across **all active projects**, each with `projectId` + `projectName` |

In `app.js`: `app.use('/api/projects', projectsRouter)` and mount nested routers with `express.Router({ mergeParams: true })`.

### Service changes

- **`services/accounts.js`**
  - `upsertAccount(projectId, platform, data)`: find by `{ project_id, platform }` instead of `{ platform }`.
  - After saving, call `syncSiblings(row)`: copy `access_token_enc`, `refresh_token_enc`, `token_expires_at`, `status` to other rows with the same `platform + external_id`.
  - `publicView` also returns `projectId` and `sharedWith` (names of other projects using the same account).
- **`services/posts.js`** `check(raw, projectId)`: load only that project's accounts for the "is connected" check, and return the account ids so `POST /posts` can store `platform_account_id` on each target.
- **`services/tokens.js`** `ensureFresh` / `testAccount`: after refreshing a Google token or changing `status`, call `syncSiblings`.
- **`routes/posts.js`**
  - Create sets `posts.project_id` and `post_targets.platform_account_id`.
  - List filters `where: { project_id }`.
  - Remote delete uses `t.platform_account_id` (fall back to `{ project_id: post.project_id, platform }`).

### OAuth (`routes/oauth.js`)

- `GET /api/oauth/:platform/start?project=<id>`: validate that the project exists and is not archived; store `project_id` in `oauth_states`.
- Callback reads `row.project_id` and passes it into `provider.callback(code, verifier, projectId)` → `upsertAccount(projectId, …)`.
- `clientDone` adds `project=<id>` to the redirect, so the client switches to that project and shows the flash there.
- **Meta page picker:** `stash({ pages, scopes, projectId })`; `saveMetaPage(ctx, pageId)` writes into `ctx.projectId`. The picker can show "already used in project X" next to pages that are linked elsewhere.
- **YouTube:** keep `prompt: 'consent'` and add `select_account` (`prompt: 'consent select_account'`), so you can pick a different Google account/brand channel per project.
- **LinkedIn:** the current scopes (`w_member_social`) only post to **your personal profile**, so every project's LinkedIn will be the same person. Posting to LinkedIn **company pages** needs the Community Management API (`w_organization_social`). That is out of scope here; see "Later".

### Worker (`worker/publisher.js`)

- `runTarget`: load the account with `PlatformAccount.findByPk(t.platform_account_id)`, falling back to `{ project_id: post.project_id, platform: t.platform }`. If neither exists, fail with the existing "not connected / reconnect" error.
- On `err.reconnect`: mark **that** account (by id) expired, plus its siblings, not every account on the platform.
- `tokenHealth`: unchanged (it already loops over all rows). Skip the projects that are archived.
- Logs: add the project name to the "Publishing to …" log line.

## 3. Client

### Project context

- New `client/src/projects/ProjectProvider.jsx` + `useProject()` hook:
  - Loads `/api/projects`, keeps `activeProjectId` in state and in `localStorage` (`sa.activeProject`, wrapped in try/catch).
  - Exposes `{ projects, active, setActive, reload }`.
  - If the URL has `?project=<id>` (OAuth return), switch to it and strip the param.
- Wrap `<Layout>` with it in `App.jsx`. While there are **no projects**, render the "Create your first project" screen instead of the routes.
- Helper `projectApi(path)` → `/api/projects/${active.id}${path}` so pages don't build URLs by hand.

### Header switcher (`components/Layout.jsx`)

- Dropdown left of the nav: colored dot + project name, list of projects, "＋ New project", "Manage projects".
- Switching projects re-mounts the page (`key={active.id}` on `<Outlet>`) so all local state resets.
- Token alert banner uses the global `/api/connections/alerts` and shows, for example, "Xavia · Instagram token expires in 3 day(s)". "Reconnect" switches to that project and opens Connections.

### Pages

| Page | Change |
|---|---|
| **New `Projects.jsx`** (`/projects`) | Cards: name, color, connected-platform icons, post count, edit / archive / delete. Create form (name, color, icon) |
| `Connections.jsx` | Use the active project's endpoints; start OAuth with `/api/oauth/<via>/start?project=<id>`; title shows "Connections · <project>"; show a "Shared with: Personal" tag when `sharedWith` is set |
| `Compose.jsx` | Load connections and post to the active project's endpoints. Show the project name next to the Publish button ("Publishing to **Xavia**") to avoid posting to the wrong brand |
| `History.jsx` | Lists the active project's posts. Optional "All projects" toggle later |
| `PostDetail.jsx` | Uses the global post route. If `post.projectId` ≠ active project, show a small "in project X" tag with a switch link |
| `Quests.jsx` / game | XP stays global: `GameProvider` fetches posts across all projects (add `GET /api/posts?all=true` or loop over projects). "Full Party" counts as done if **any** project has all 4 connected |

Add `/projects` to the `links` list in Layout (icon `FaFolder`).

## 4. Shared accounts (same account in several projects)

- Example: your LinkedIn profile in every project, or one Facebook Page used by two projects.
- Each project has its **own row**; rows are linked only by `platform + external_id`.
- Token changes on one row (OAuth reconnect, Google refresh, expiry, error status) are copied to the others by `syncSiblings`, so you reconnect once, not once per project.
- Disconnecting in one project removes **only that project's row**.
- Google: each new consent can issue a new refresh token; copying it to the siblings keeps them all on the latest one, so an older revoked token can't break one project.

## 5. Build phases

Each phase ends with a **"Done when"** check.

### Phase P1: Database ✅
- [x] Back up the DB
- [x] Migrations 1 and 2, `Project` model, associations, update `PlatformAccount` model
- [x] Update `plans/01-database.md`

**Done when:** `npm run db:migrate` runs on the current DB, a "Default" project exists, all existing accounts/posts point to it, and `db:migrate:undo` + `db:migrate` both work on a copy.

### Phase P2: Projects API + scoped routes ✅
- [x] `routes/projects.js` (CRUD, archive, `loadProject`)
- [x] Move connections and post create/list/validate under `/api/projects/:projectId`
- [x] `upsertAccount(projectId, …)`, `syncSiblings`, scoped `check()`
- [x] Global `/api/connections/alerts`

**Done when:** with curl you can create project B, `GET /api/projects/B/connections` shows 4 × disconnected, and project Default still shows its old connections.

### Phase P3: OAuth per project (code done, needs a live check)
- [x] `?project=` on start, `oauth_states.project_id`, project-aware callbacks and Meta picker
- [x] YouTube `select_account`

**Done when:** you connect a *different* Facebook Page + IG to project B, and project Default's Page is untouched; connecting the same LinkedIn profile to both creates two rows and reconnecting in one updates the other.

### Phase P4: Worker + posts (code done, needs a live check)
- [x] `platform_account_id` saved on targets; worker, retry and remote delete use it
- [x] Reconnect errors mark only the affected account (+ siblings)

**Done when:** a post queued in project B publishes to B's Page; then switching the active project in the UI mid-upload changes nothing; retrying a failed B target still uses B's account.

### Phase P5: Client (built, needs a browser check)
- [x] `ProjectProvider`, first-run "Create project" screen, header switcher
- [x] Projects page; Connections, Compose and History use the active project
- [x] Global alert banner with project names; OAuth return switches project
- [x] Game stats stay global

**Done when:** with 2 projects you can switch in the header and see different connections and history, the switch survives a page reload, and an expiring token in the inactive project still shows in the banner.

### Phase P6: Polish (optional) ✅ built
- [x] "All projects" filter on History
- [x] Per-project default caption footer / hashtags (a `settings JSON` column on `projects`)
- [x] Cross-post: "Also publish to project X" in Compose (creates one post per project)

## 6. Risks and edge cases

| Case | Handling |
|---|---|
| Posting to the wrong brand | Project name + color shown in the header and next to Publish |
| Project archived while posts are queued | Queued targets still publish (they have `platform_account_id`); archived projects are hidden from the switcher, not frozen |
| Account disconnected while a post is queued | `platform_account_id` becomes NULL → worker falls back to the project's current account for that platform, else fails with "reconnect" |
| Meta: the same Page token is shared by FB and IG rows | Unchanged; both rows live in the same project |
| Old bookmarks to `/api/connections` | Removed. Only the client uses it, and it is updated in the same change |
| Cross-posted media | Each project's post gets its own media rows pointing at the same files; delete/cleanup skip a file while another row still uses it |
| Migration index name differs | Look it up with `SHOW INDEX` in the migration instead of hard-coding it |

## Later (not in this plan)

- **LinkedIn company pages** per project (needs the Community Management API approval and `w_organization_social`).
- **More than one account per platform in a project** (e.g. two Instagram accounts in one brand): would change Compose to pick accounts instead of platforms.
- **Per-project OAuth apps** (separate Meta app per client): only needed if you manage clients' apps; would move credentials from `.env` into an encrypted `project_credentials` table.
