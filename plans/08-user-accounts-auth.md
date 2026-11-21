# 08: User accounts and sign-in (multi-user)

## Goal

Right now the app has one user and no logins. Anyone who can reach `localhost` sees every project. After this change:

1. People **sign up and sign in** with **email + password** or **LinkedIn** (live now). **Facebook** and **Instagram** sign-in are built behind flags and switched **off** for now.
2. Each user sees and manages **only their own** projects, connections, posts, media, API keys and alerts.
3. Everything that exists today (projects, connections, posts, media, API keys) moves to the owner account **ashar.ashfaq2@gmail.com**.
4. There is a **Settings** page (name, phone number, password, sign-in methods) and a **Forgot password** flow that sends email over SMTP.
5. **Everything else works the same.** Compose, History, Connections, Projects, Integration, the external API, MCP and the worker keep their behaviour. The new parts are the login and the "whose data is this" checks.

```
User ashar.ashfaq2@gmail.com           User someone@else.com
 ├─ Project "Personal"  (existing)      └─ Project "My brand"
 ├─ Project "Xavia"     (existing)          ├─ LinkedIn (their profile)
 └─ ...all current data                     └─ Instagram @theirs
```

> **Two different LinkedIn flows.** *Signing in* with LinkedIn (who you are in this app) is separate from *connecting* LinkedIn to a project (which profile/page you post to). They use the same LinkedIn app but different redirect URIs, scopes and tables. Signing in never connects a project, and connecting never signs anyone in.

## Decisions (and why)

| Decision | Choice | Why |
|---|---|---|
| Session type | **Server-side sessions** in a `user_sessions` table, opaque random token in an **httpOnly cookie** (`sa_session`) | Instant logout and "sign out everywhere" (needed after a password change or reset). No JWT revocation problem |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS, `Path=/`, 30-day sliding expiry | The client already talks to the API through the Vite proxy (same origin), so cookies just work. `Lax` still sends the cookie on the top-level OAuth redirect |
| CSRF | `SameSite=Lax` + state-changing `/api/*` requests must be JSON or multipart **and** pass an `Origin` check against `CLIENT_URL` | Simple, no token plumbing in every form |
| Password hashing | **bcryptjs**, cost 12 | Pure JS: no native build on Windows |
| Password rules | Min 8 chars, at least one letter and one digit, max 128 | Reasonable, not annoying |
| Ownership | `projects.user_id` (NOT NULL). Everything else is owned **through its project** | Posts, connections, API keys and project media already hang off `project_id`; one new column gives full scoping |
| Media uploaded in the UI before a post exists | New `media_files.user_id` | These rows have `project_id = NULL` today; without an owner, user A could attach user B's upload |
| Project names | UNIQUE per user (`user_id, name`), not globally | Two users can both have a project called "Personal" |
| Shared accounts (`syncSiblings`) | Only sync rows **of the same user** | Today a reconnect copies tokens to every row with the same `platform + external_id`. Across users that would leak tokens and project names |
| Email + social with the same email | **Auto-link** only when the provider says the email is verified (LinkedIn OIDC `email_verified: true`) **and** the existing account's email is verified. Otherwise ask the user to sign in with their password first and link from Settings | Prevents account takeover through an unverified social email |
| Email verification | Send a verify link on sign-up. Unverified users **can** use the app; a banner reminds them. Verification is required for social auto-linking | Keeps sign-up friction low but still proves ownership of the email |
| Forgot password | Random 32-byte token, store **sha256** only, **30 min** expiry, single use. The response is always "If that email exists, we sent a link" | No user enumeration; a leaked DB doesn't leak working tokens |
| After password change or reset | Delete every other session of that user | Standard; kills stolen sessions |
| Social-only users | `users.password_hash` NULL. Settings shows **Set password** instead of **Change password** | A LinkedIn-only user can still add email login later |
| Last sign-in method | You cannot unlink LinkedIn if you have no password and no other provider | Prevents locking yourself out |
| Facebook / Instagram sign-in | Code path built, buttons shown as **"Coming soon"** (disabled) while `AUTH_FACEBOOK_ENABLED=false` / `AUTH_INSTAGRAM_ENABLED=false` | You asked to activate LinkedIn only for now |
| Who sees what | Every user sees only their own data. There is **no admin role** in this phase | Not requested; see "Later" |
| External API / MCP | Unchanged. Keys are per project, and the project now belongs to a user | Those callers never had a login; the project key is still the auth |
| Worker | Unchanged. It still publishes queued targets for every user | It runs server-side and already uses `platform_account_id` |
| Secrets | SMTP password and the owner password go **only** in `server/.env` (git-ignored), never in this repo or the plans | `.env.example` gets empty placeholders |

## 1. Database

### New table `users`

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| email | VARCHAR(255) | UNIQUE, stored lower-cased and trimmed |
| email_verified_at | DATETIME NULL | |
| password_hash | VARCHAR(100) NULL | NULL = social-only account |
| name | VARCHAR(100) | |
| phone | VARCHAR(32) NULL | Stored as typed after normalising to `+` and digits; validated 7–15 digits |
| avatar_url | VARCHAR(1000) NULL | From LinkedIn on first sign-in, editable later |
| last_login_at | DATETIME NULL | |
| disabled_at | DATETIME NULL | Blocks sign-in (manual lever, no UI in this phase) |
| created_at / updated_at | DATETIME | |

### New table `user_identities` (social sign-in links)

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| user_id | INT FK → users.id ON DELETE CASCADE | |
| provider | ENUM('linkedin','facebook','instagram') | |
| provider_user_id | VARCHAR(191) | LinkedIn OIDC `sub` |
| email | VARCHAR(255) NULL | Email the provider returned (Instagram returns none) |
| created_at / updated_at | DATETIME | |

UNIQUE(`provider`, `provider_user_id`); UNIQUE(`user_id`, `provider`).

We store **no social access tokens** here. Sign-in only needs the identity; posting tokens stay in `platform_accounts`.

### New table `user_sessions`

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| user_id | INT FK → users.id ON DELETE CASCADE | |
| token_hash | CHAR(64) UNIQUE | sha256 of the cookie value; the raw token is never stored |
| expires_at | DATETIME | Sliding: pushed to now + 30 days when a request comes in and less than 15 days remain |
| last_seen_at | DATETIME | |
| user_agent | VARCHAR(255) NULL | Shown in Settings → "Active sessions" |
| ip | VARCHAR(64) NULL | |
| created_at | DATETIME | |

### New table `auth_tokens` (password reset and email verification)

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| user_id | INT FK → users.id ON DELETE CASCADE | |
| purpose | ENUM('reset_password','verify_email') | |
| token_hash | CHAR(64) UNIQUE | sha256 |
| expires_at | DATETIME | Reset: 30 min. Verify: 48 h |
| used_at | DATETIME NULL | |
| created_at | DATETIME | |

Creating a new token of the same purpose deletes the user's older unused ones.

### New table `auth_oauth_states` (sign-in OAuth, separate from connecting)

Same shape as `oauth_states` (`state`, `provider`, `code_verifier`, `created_at`) plus `mode` ENUM('login','link') and `user_id INT NULL` (set for `link`). A separate table keeps the existing connect flow untouched.

### Changes to existing tables

| Table | Change |
|---|---|
| `projects` | Add `user_id INT NOT NULL FK → users.id ON DELETE CASCADE`. **Drop** UNIQUE(`name`), **add** UNIQUE(`user_id`, `name`). INDEX(`user_id`, `archived_at`) |
| `media_files` | Add `user_id INT NULL FK → users.id ON DELETE CASCADE` (set on every new upload) |
| `oauth_states` | Add `user_id INT NULL` (who started the connect flow; the callback checks it still owns the project) |
| `platform_accounts`, `posts`, `post_targets`, `activity_logs` | No change: owned through `project_id` |

### Migrations (new files in `server/src/db/migrations/`)

1. `20261122000001-create-users-auth.js`: create `users`, `user_identities`, `user_sessions`, `auth_tokens`, `auth_oauth_states`.
2. `20261122000002-add-user-scope.js`, in one transaction:
   - Insert the **owner user** `ashar.ashfaq2@gmail.com`, name "Ashar Ashfaq", `email_verified_at = NOW()`. The password hash comes from env **`OWNER_PASSWORD`** at migration time (`bcryptjs.hashSync`). If `OWNER_PASSWORD` is empty, the migration **fails** with a clear message instead of creating a user without a password. The password is never written into the migration file.
   - Add `projects.user_id` as NULL, set every row to the owner, make it NOT NULL, add the FK.
   - Look up the real name of the unique index on `projects.name` with `SHOW INDEX` (same approach as migration 2 in `04-projects.md`), drop it, add `projects_user_name_uq`.
   - Add `media_files.user_id`. Backfill: rows with a project get the project's user, rows without a project get the owner.
   - Add `oauth_states.user_id`.
   - `down()` removes the columns and tables and puts back the global unique on `projects.name`. That only works while project names are still globally unique, so say so in a comment.
3. **Before migrating:** run `npm run db:backup --prefix server`. After migrating, remove `OWNER_PASSWORD` from `server/.env`.

### Models

- New `User`, `UserIdentity`, `UserSession`, `AuthToken`, `AuthOAuthState` in `server/src/db/models/`; register them in `models/index.js`.
- Associations: `User.hasMany(Project, as 'projects')`, `Project.belongsTo(User, as 'user')`, `User.hasMany(UserIdentity, as 'identities')`, `User.hasMany(UserSession)`.
- `Project.js`: remove `unique: true` from `name`, add `user_id`.
- `MediaFile.js`: add `user_id`.
- Update `plans/01-database.md` with the new tables and columns.

## 2. Server

### New dependencies (`server/package.json`)

`bcryptjs`, `cookie-parser`, `nodemailer`, `express-rate-limit`.

### New env (`server/.env`, placeholders in `.env.example`, documented in `03-env-config.md`)

```
# ── Auth ──────────────────────────────────────────
SESSION_DAYS=30
# Only during the user-scope migration, then delete the line
OWNER_PASSWORD=
# Sign-in providers
AUTH_LINKEDIN_ENABLED=true
AUTH_LINKEDIN_REDIRECT_URI=http://localhost:5000/api/auth/linkedin/callback
AUTH_FACEBOOK_ENABLED=false
AUTH_FACEBOOK_REDIRECT_URI=http://localhost:5000/api/auth/facebook/callback
AUTH_INSTAGRAM_ENABLED=false
AUTH_INSTAGRAM_REDIRECT_URI=http://localhost:5000/api/auth/instagram/callback

# ── Email (SMTP) ──────────────────────────────────
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
# Shown as the sender name in emails
SMTP_FROM_NAME=Social Automations
```

The real SMTP values (Gmail, port 465, app password) go **only** into `server/.env`. With port 465 nodemailer uses `secure: true`. LinkedIn sign-in reuses `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`; only the redirect URI is new and must be added to the LinkedIn app (see section 5).

### New services

- **`services/auth.js`**
  - `hashPassword`, `verifyPassword` (bcryptjs, cost 12), `validatePassword` (rules above).
  - `createSession(user, req)` → random 32 bytes (base64url) → stores sha256 → sets the cookie.
  - `destroySession(token)`, `destroyOtherSessions(userId, keepSessionId)`.
  - `publicUser(u)` → `{ id, email, emailVerified, name, phone, avatarUrl, hasPassword, identities: ['linkedin'], createdAt }`.
- **`services/mailer.js`**: nodemailer transport built from the SMTP env, `sendMail({ to, subject, html, text })`. If SMTP isn't configured in development, log the email (including the link) to the console instead of failing.
- **`services/emails.js`**: templates (plain HTML + text): *Verify your email*, *Reset your password*, *Your password was changed*. Links point at `CLIENT_URL`.

### New middleware

- **`middleware/auth.js`**
  - `loadUser`: reads `sa_session` (cookie-parser), finds the session by hash, checks expiry and `users.disabled_at`, slides the expiry, sets `req.user` and `req.session`. Mounted for all `/api/*` UI routes.
  - `requireUser`: 401 `{ ok:false, error:'Sign in required', code:'AUTH_REQUIRED' }` when there is no `req.user`.
  - `checkOrigin`: on POST/PATCH/PUT/DELETE under the UI `/api`, reject if `Origin` is present and isn't `CLIENT_URL` or `SERVER_URL`.
- **`middleware/loadProject.js`**: also require `project.user_id === req.user.id`, **404** otherwise (don't reveal that the project exists).

### New routes: `routes/auth.js` → `/api/auth`

| Method | Route | Does |
|---|---|---|
| GET | `/api/auth/providers` | `{ email: true, linkedin: true, facebook: false, instagram: false }` for the login buttons |
| POST | `/api/auth/signup` | `{ name, email, password }` → create user, send the verify email, start a session. 409 if the email exists |
| POST | `/api/auth/login` | `{ email, password }` → session. One generic error: "Wrong email or password" |
| POST | `/api/auth/logout` | Destroy the current session, clear the cookie |
| GET | `/api/auth/me` | Current user or 401 |
| POST | `/api/auth/forgot-password` | `{ email }` → always 200; if the user exists, email a reset link `CLIENT_URL/reset-password?token=…` |
| POST | `/api/auth/reset-password` | `{ token, password }` → set the password, mark the token used, delete **all** sessions, send the "password changed" email, start a fresh session |
| POST | `/api/auth/verify-email` | `{ token }` → set `email_verified_at` |
| POST | `/api/auth/resend-verification` | Signed-in only |
| GET | `/api/auth/:provider/start?mode=login\|link` | OAuth sign-in start (LinkedIn now). `link` requires a signed-in user |
| GET | `/api/auth/:provider/callback` | See below |

Rate limits (`express-rate-limit`, in memory): login 10 per 15 min per IP+email; forgot-password 5 per hour per IP and 3 per hour per email; signup 10 per hour per IP.

### LinkedIn sign-in (OIDC)

- Authorize URL: `https://www.linkedin.com/oauth/v2/authorization`, `scope=openid profile email`, `redirect_uri=AUTH_LINKEDIN_REDIRECT_URI`, `state` in `auth_oauth_states`, plus `nonce`.
- Callback: exchange the code at `/oauth/v2/accessToken`, then `GET https://api.linkedin.com/v2/userinfo` → `sub`, `name`, `email`, `email_verified`, `picture`. (Same calls `routes/oauth.js` already makes when connecting LinkedIn.)
- Resolution order:
  1. Identity `(linkedin, sub)` exists → sign in as that user.
  2. `mode=link` → attach the identity to `req.user` (409 if it already belongs to someone else) → back to `/settings?linked=linkedin`.
  3. A user has that email, **both** sides are verified → link and sign in.
  4. A user has that email but it isn't verified on one side → **don't link**. Redirect to `/login?error=…` with "An account with this email exists. Sign in with your password, then link LinkedIn in Settings."
  5. No user → create the user (`email_verified_at` = now if LinkedIn says verified, `password_hash` NULL, name and avatar from LinkedIn) plus the identity → sign in.
- Set the session cookie on the server's redirect response, then redirect to `CLIENT_URL/` (or `/login?error=…`).

> Cookie domain detail: the OAuth callback hits the **server** origin (`localhost:5000`), while the UI is on `localhost:5173`. Browsers scope cookies by host, not port, so a cookie set on `localhost` is sent to both. This also holds for `127.0.0.1` as long as `CLIENT_URL` and the redirect URIs use the **same host name**. Use `localhost` everywhere.

### Facebook / Instagram sign-in (built, switched off)

- **Facebook:** Facebook Login, `scope=email,public_profile`, `GET /me?fields=id,name,email,picture`. Facebook doesn't say whether the email is verified, so rule 3 above is **never** used for Facebook: it always creates a new account or asks the user to link from Settings.
- **Instagram:** "Instagram API with Instagram Login" works only for **Business/Creator** accounts and returns **no email**. A new user signing in with Instagram has to type an email on a small "Finish sign-up" screen, which sends a verify email. Personal Instagram accounts can't sign in (Meta retired the Basic Display API).
- Both stay behind their `AUTH_*_ENABLED` flags. The login page shows them as disabled "Coming soon" buttons.

### New routes: `routes/account.js` → `/api/account` (all `requireUser`)

| Method | Route | Does |
|---|---|---|
| PATCH | `/api/account/profile` | `{ name, phone, avatarUrl? }` (zod) |
| POST | `/api/account/password` | `{ currentPassword?, newPassword }`. `currentPassword` is required when the user already has one. Deletes the user's other sessions and sends the "password changed" email |
| GET | `/api/account/sessions` | List of active sessions (device, IP, last seen, "this device") |
| DELETE | `/api/account/sessions/:id` | Sign out one session; `DELETE /api/account/sessions` signs out all others |
| DELETE | `/api/account/identities/:provider` | Unlink, blocked if it is the last sign-in method |

Changing the email address is **not** in this phase (it needs re-verification of the new address; see "Later").

### Scoping existing routes (the main safety work)

`app.js`: add `cookieParser()`, `loadUser`, `checkOrigin`. Mount `/api/auth` and `/api/health` **without** `requireUser`; put `requireUser` on everything else under the UI `/api` (`/api/projects`, `/api/connections`, `/api/media`, `/api/posts`, `/api/oauth/*/start`, `/api/oauth/meta/*`, `/api/oauth/linkedin/accounts|select`, `/api/config`).

| Route / service | Change |
|---|---|
| `routes/projects.js` list / create | `where: { user_id: req.user.id }`; create sets `user_id`. The duplicate-name check is per user |
| `loadProject` | Ownership check (404 when not yours) |
| `GET /api/posts` (all projects) | Only posts whose project belongs to `req.user` |
| `GET/DELETE /api/posts/:id`, retry | `svc.getPost/deletePost/retryTarget` get a `userId` and 404 when the post's project isn't the user's |
| `GET /api/connections/alerts` | Only the user's active projects |
| `POST /api/media` (UI upload) | Set `media_files.user_id = req.user.id` |
| `GET /api/media/:id/file`, `/thumb` | 404 unless `media.user_id` is the user's (or the media's project is) |
| `services/posts.createPost` | When a post attaches media by id, require the media to belong to the same user (or the same project) |
| Cross-post ("also publish to project X") | Every target project must belong to the user |
| `services/accounts.syncSiblings` | Limit to rows whose project has the **same `user_id`** |
| `routes/oauth.js` start | Require a signed-in user who owns `?project=`; save `user_id` in `oauth_states` |
| `routes/oauth.js` callback | Re-check that `row.user_id` still owns `row.project_id` before `upsertAccount` |
| Meta / LinkedIn pickers | `stash()` also stores `userId`; `/meta/pages`, `/meta/select`, `/linkedin/accounts`, `/linkedin/select` require that the same user is signed in. "Used in project X" lists only **the user's own** projects |
| `/media/*` public router (Instagram downloads) | Unchanged: random UUID file names, needed by Meta without cookies |
| `/api/v1` and `/api/v1/mcp` | Unchanged: project API key auth |
| `worker/publisher.js`, `tokenHealth` | Unchanged |
| `services/backup.js` | Unchanged; the new tables are in the same DB |

### Network access

`app.js` currently allows UI routes from loopback only, because there was no login. Keep that default. Add `UI_REMOTE_ACCESS=false`; when it is `true`, skip the loopback gate for UI routes (they are behind login now). That is the switch to flip when this is deployed for other people.

## 3. Client

### Auth context

- New `client/src/auth/AuthProvider.jsx` + `useAuth()`: calls `/api/auth/me` on load and exposes `{ user, loading, login, signup, logout, refresh }`.
- `api.js`: on a 401 with `code === 'AUTH_REQUIRED'`, fire an `auth:expired` event; `AuthProvider` clears the user and sends them to `/login?next=<current path>`. Uploads (`uploadMedia`) use the same handling.
- `ProjectProvider`: key its `localStorage` item per user (`sa.activeProject.<userId>`) so switching accounts in one browser doesn't select someone else's project id.

### Routes (`App.jsx`)

```
Public (no Layout):    /login  /signup  /forgot-password  /reset-password  /verify-email  /auth/finish (Instagram email step, later)
Signed in (Layout):    everything that exists today + /settings
```

- `<RequireAuth>` wraps `<ProjectProvider><Layout/></ProjectProvider>`. Signed-out users go to `/login?next=…`; signed-in users who open `/login` go to `/compose`.
- After sign-up, a user with **no projects** gets the existing "Create your first project" screen. No other change to the first-run flow.

### New pages

| Page | Contents |
|---|---|
| `pages/auth/Login.jsx` | Email + password, "Forgot password?", **Continue with LinkedIn** (active), Facebook and Instagram (disabled, "Coming soon"), link to sign up. Shows `?error=` from OAuth |
| `pages/auth/Signup.jsx` | Name, email, password (+ strength hint), same social buttons |
| `pages/auth/ForgotPassword.jsx` | Email field → "If an account exists, we've emailed a link" |
| `pages/auth/ResetPassword.jsx` | New password + confirm, reads `?token=`, then signs in and goes to `/compose` |
| `pages/auth/VerifyEmail.jsx` | Reads `?token=`, shows success or "link expired" + resend button |
| `pages/Settings.jsx` | Sections: **Profile** (name, phone, avatar URL; email shown read-only with a Verified / Not verified badge + resend), **Password** (change, or set when `hasPassword` is false), **Sign-in methods** (LinkedIn linked / Link, Unlink), **Active sessions** (list, sign out others) |

Reuse the existing components in `components/ui.jsx` and the current look; no new design system.

### Layout

- Header: user menu on the right (avatar/initials, name, email) → **Settings**, **Sign out**.
- Add `/settings` to the nav (icon `FaCog`), or keep it in the user menu only.
- Banner when the email isn't verified: "Verify your email. [Resend]".

## 4. Owner account and existing data

- Migration 2 creates `ashar.ashfaq2@gmail.com` with `OWNER_PASSWORD` from `server/.env` (the password you gave in chat). Set it, run the migration, then remove the line.
- Every existing project (and through it every connection, post, target, log, API key and project media) gets `user_id` = owner. UI uploads without a project also go to the owner.
- Existing project API keys and MCP clients keep working without any change.
- After the first sign-in, change the password from Settings. It has appeared in chat, so treat it as shared.
- You can also click **Link LinkedIn** in Settings to sign in with LinkedIn next time.

## 5. External setup

### LinkedIn app (developer portal)

1. **Products:** make sure **"Sign In with LinkedIn using OpenID Connect"** is added. It is probably already there, since the connect flow uses `openid profile email`.
2. **Auth → Authorized redirect URLs:** add `http://localhost:5000/api/auth/linkedin/callback`. When running on HTTPS (`06-local-https.md`), add the `https://` version as well. Keep the existing `/api/oauth/linkedin/callback`.
3. Update `plans/guides/linkedin-setup.md` with these two steps.

### Gmail SMTP

- The SMTP user is a Gmail account with an **app password** (what was provided). Gmail limits sending to about 500 recipients per day, which is fine for resets and verification.
- Gmail rewrites the From header to the authenticated account, so `SMTP_FROM` must be that same address.
- The app password was pasted in chat. Consider generating a new one in the Google account and putting only the new one in `server/.env`.

## 6. Build phases

Each phase ends with a **"Done when"** check.

### Phase A1: Database + owner migration
- [ ] `npm run db:backup`
- [ ] Migration 1 (auth tables), migration 2 (owner + `user_id` columns + per-user project name unique)
- [ ] Models + associations, update `01-database.md`

**Done when:** after migrating, `users` has the owner, every `projects.user_id` is the owner, `media_files.user_id` is filled, and `db:migrate:undo` ×2 + `db:migrate` works on a copy of the DB.

### Phase A2: Email + password auth (server)
- [ ] `services/auth.js`, `middleware/auth.js`, `routes/auth.js` (signup, login, logout, me)
- [ ] `services/mailer.js`, `services/emails.js`; verify email
- [ ] Forgot / reset password; rate limits; `checkOrigin`
- [ ] env, `.env.example`, `03-env-config.md`

**Done when:** with curl, signup → cookie → `/api/auth/me` works; a wrong password gives the generic error; forgot-password sends a real email through Gmail SMTP; the reset link works once and then fails; after a reset the old cookie gets 401.

### Phase A3: Scope every UI route to the user
- [ ] `requireUser` on the UI `/api`, ownership in `loadProject`
- [ ] Global post, media, alert and cross-post routes check ownership
- [ ] `syncSiblings` and the picker "used in" lists limited to the same user
- [ ] Connect-OAuth start/callback/pickers check the user

**Done when:** with two users, user B gets **404** on A's `/api/projects/:id/...`, `/api/posts/:id`, `/api/media/:id/file`, and A's alerts don't show for B; the owner still sees all old data; `/api/v1` with an existing project key still posts.

### Phase A4: Client auth
- [ ] `AuthProvider`, `RequireAuth`, 401 handling in `api.js` and `uploadMedia`
- [ ] Login, Signup, Forgot, Reset, Verify pages
- [ ] User menu, unverified banner, per-user active-project key

**Done when:** opening the app signed out lands on `/login`; you sign in as the owner and see every existing project; sign out → back to `/login`; a deep link (`/history/12`) survives the login redirect.

### Phase A5: LinkedIn sign-in
- [ ] Redirect URI added to the LinkedIn app
- [ ] `/api/auth/linkedin/start|callback`, identity linking rules, `mode=link` from Settings

**Done when:** a brand-new LinkedIn user can sign in and gets an empty account with the "Create your first project" screen; the owner can link LinkedIn in Settings and then sign in with it; signing in with LinkedIn never adds a project connection.

### Phase A6: Settings
- [ ] Profile (name, phone), change/set password, sign-in methods, active sessions

**Done when:** name and phone changes persist; a password change with a wrong current password fails; after a correct change, other browsers are signed out and a "password changed" email arrives; unlinking the only sign-in method is blocked.

### Phase A7: Facebook / Instagram sign-in (flagged off)
- [ ] Providers implemented behind `AUTH_FACEBOOK_ENABLED` / `AUTH_INSTAGRAM_ENABLED`
- [ ] "Coming soon" buttons; Instagram "finish sign-up with email" screen

**Done when:** with the flags off, `/api/auth/facebook/start` returns 404 and the buttons are disabled; with a flag on in dev, the flow reaches the provider.

## 7. Risks and edge cases

| Case | Handling |
|---|---|
| Owner migration run without `OWNER_PASSWORD` | Migration fails loudly; nothing is half-applied (one transaction) |
| Two users connect the same Facebook Page | Allowed: each has their own row. Tokens are **not** synced across users, so each reconnects on their own |
| OAuth connect callback after the project changed owner or was deleted | Callback re-checks ownership and redirects with an error |
| Session cookie on `localhost` vs `127.0.0.1` | Use `localhost` in `CLIENT_URL`, `SERVER_URL` and every redirect URI |
| User enumeration | Same response for "no such email" on login and forgot-password; signup's 409 is the one place that reveals it (acceptable; rate-limited) |
| Brute force | Rate limits on login and forgot-password; bcrypt cost 12 |
| Reset link opened twice | Second use: "This link has expired or was already used" |
| SMTP down | Signup still succeeds (the verify email can be resent); forgot-password logs the error and still answers 200 |
| Stale `sa.activeProject` from another user in the same browser | Key is per user; an unknown id falls back to the first project |
| MCP stdio bridge / external API | Not affected (project keys) |

## Later (not in this plan)

- **Change email address** (verify the new one before switching).
- **Admin role**: list users, disable accounts, impersonate for support.
- **Delete my account** (with export first).
- **Team members per project** (invite someone to a project, roles), which would replace `projects.user_id` with a `project_members` table.
- **2FA** (TOTP).
- Turning on Facebook / Instagram sign-in once the Meta app review covers `email` / Instagram Login.
