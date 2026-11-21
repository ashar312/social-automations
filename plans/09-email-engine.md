# 09: Email engine (SMTP + cron)

**Depends on:** [08-user-accounts-auth.md](08-user-accounts-auth.md) (users, sessions, `services/mailer.js`, SMTP env).

## Goal

One place that decides **what** email a user gets, **when**, and makes sure it goes out **exactly once**, even if the server restarts or Gmail is briefly down.

| # | Email | Kind | Trigger |
|---|---|---|---|
| 1 | **Welcome** | Transactional | Right after sign-up (email or LinkedIn) |
| 2 | **Social account connected** | Transactional | After a project connects LinkedIn / YouTube / Facebook / Instagram |
| 3 | **Password changed** | Transactional (security) | After a change in Settings or a reset |
| 4 | **Forgot password** | Transactional (security) | `POST /api/auth/forgot-password` |
| 5 | **Daily summary** of scheduled posts that went out | Digest | Cron, every morning in the user's time zone, for yesterday |
| 6 | **Schedule your first post** | Lifecycle nudge | Cron: 24 h after sign-up and still no post |
| 7 | **How was your experience?** | Lifecycle (feedback) | Cron: 3 days after the user's first published post |
| 8 | **We miss you** (inactive 4 days) | Lifecycle nudge | Cron: no activity for 4 days |

Transactional and security emails (1–4) always go out. Digest and lifecycle emails (5–8) can be switched off by the user and carry an unsubscribe link.

## Architecture

```
 Events (API, OAuth callback)                Cron jobs (node-cron)
   signup → welcome                            every 15 min: lifecycle scan  (6, 7, 8)
   connect → social_connected                  every hour:   daily summary   (5) for users at 09:00 local
   password change/reset → password_changed            │
   forgot password → reset_password                    │
            │                                          │
            └──────────── enqueue(userId, type, dedupeKey, payload) ──────────┘
                                        │
                              email_outbox (MySQL)       ← UNIQUE(user_id, type, dedupe_key) = never twice
                                        │
                       sender job (every 30 s, + "kick" for urgent mail)
                        lock rows → render template → nodemailer (Gmail SMTP 465) → mark sent / retry
```

- **Outbox pattern:** nothing calls SMTP directly from a request. Everything is a row in `email_outbox` first. A request that sends mail stays fast, a Gmail hiccup becomes a retry instead of a lost email, and a restart picks up where it left off.
- **Idempotency:** every email has a `dedupe_key`. Enqueuing the same `(user, type, key)` twice is a no-op (`INSERT … ON DUPLICATE KEY` is ignored). Cron jobs can safely run more than once, overlap, or catch up after downtime.
- **Urgent mail** (forgot password, password changed): after enqueueing, the request calls `sender.kick()` so it goes out within a second or two instead of waiting for the next tick.
- **Render at send time**, from fresh data plus the stored payload. A daily summary shows the post states as they are when sent.

### Where it runs

The engine runs inside the existing server process, next to the publisher worker (`worker/publisher.js` already uses timers for cleanup, token health and backups). New file `server/src/email/engine.js` with `start()` / `stop()`, started from `server.js` right after the publisher.

- Cron library: **`node-cron`** (cron expressions + time zones, no native deps).
- If someday two server processes run, the row locking in the sender (`locked_at`, like `post_targets`) and the dedupe keys stop double sends. No separate lock service is needed.
- `EMAIL_ENGINE_ENABLED=false` turns off both cron and sender (handy in dev or for a second instance).

## 1. Database

### New table `email_outbox`

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| user_id | INT FK → users.id ON DELETE CASCADE | |
| type | ENUM('welcome','social_connected','password_changed','reset_password','daily_summary','first_post_nudge','feedback_request','inactive_nudge') | |
| dedupe_key | VARCHAR(100) | See the table in section 3 |
| to_email | VARCHAR(255) | Snapshot at enqueue time |
| priority | TINYINT | 1 = security, 2 = transactional, 3 = digest, 4 = lifecycle. Sent in this order |
| payload | JSON NULL | Data for the template (platforms, date, …) |
| payload_secret | TEXT NULL | **Encrypted** (existing `services/crypto.js`, `TOKEN_ENCRYPTION_KEY`) for secrets such as the raw reset token. **Wiped** after sending |
| status | ENUM('queued','sending','sent','failed','skipped','cancelled') | `skipped` = a rule said no at send time (unsubscribed, user deleted, nothing to report) |
| send_after | DATETIME | Not before this time (default now) |
| attempts | TINYINT, default 0 | |
| next_attempt_at | DATETIME NULL | Backoff |
| locked_at | DATETIME NULL | Sender lock (stale after 5 min) |
| sent_at | DATETIME NULL | |
| message_id | VARCHAR(255) NULL | From SMTP, for debugging |
| error | TEXT NULL | Last error |
| created_at / updated_at | DATETIME | |

Indexes: UNIQUE(`user_id`, `type`, `dedupe_key`); INDEX(`status`, `priority`, `send_after`); INDEX(`user_id`, `type`, `sent_at`).

### New table `email_feedback` (answers to email 7)

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| user_id | INT FK → users.id ON DELETE CASCADE | UNIQUE: one answer per user, later answers update it |
| rating | TINYINT | 1–5 |
| comment | TEXT NULL | |
| created_at / updated_at | DATETIME | |

### Changes to `users`

| Column | Type | Notes |
|---|---|---|
| timezone | VARCHAR(64), default `'Asia/Karachi'` | IANA name. Set from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`) at sign-up and editable in Settings. Owner gets `Asia/Karachi` in the migration |
| last_active_at | DATETIME NULL | Updated by `loadUser` (plan 08) at most once every 10 min per user, and on login |
| email_prefs | JSON NULL | `{ dailySummary: true, productTips: true, feedback: true }`. NULL = all true |
| first_post_published_at | DATETIME NULL | Set by the worker the first time any of the user's targets reaches `published`. Drives email 7 cheaply |

Migration: `20261123000001-email-engine.js` (create both tables, add the columns; backfill `last_active_at = NOW()` and `first_post_published_at` from the owner's oldest published target so the owner doesn't get a "first post" or "we miss you" email on day one).

## 2. Code layout

```
server/src/email/
  engine.js          start()/stop(): registers cron jobs + the sender loop
  outbox.js          enqueue(), cancel(), kick()
  sender.js          picks due rows, locks, renders, sends, retries
  jobs/
    dailySummary.js  email 5
    lifecycle.js     emails 6, 7, 8
  templates/
    layout.js        shared HTML shell (logo, footer, unsubscribe line) + text version
    welcome.js  socialConnected.js  passwordChanged.js  resetPassword.js
    dailySummary.js  firstPostNudge.js  feedbackRequest.js  inactiveNudge.js
  prefs.js           which types are optional, unsubscribe token sign/verify
server/src/services/mailer.js   (from plan 08) nodemailer transport only
```

Each template exports `render({ user, payload, secret, links }) → { subject, html, text }`. HTML is table-based with inline styles (works in Gmail/Outlook), no remote fonts, the brand logo from `PUBLIC_BASE_URL` or `CLIENT_URL` + `/brand/logo-square.svg` rendered as a PNG (`client/public/brand/`). All user text is HTML-escaped.

**Plan 08 changes:** the separate "Verify your email" message is folded into **Welcome** (it shows a *Verify email* button while the address is unverified). The "Reset your password" and "Password changed" emails from plan 08 go through this engine instead of calling `mailer` directly. `routes/auth.js` calls `outbox.enqueue(...)` + `kick()`.

## 3. The eight emails

| # | Type | Enqueued by | `dedupe_key` | `send_after` | Content |
|---|---|---|---|---|---|
| 1 | `welcome` | `signup` and first LinkedIn sign-up | `once` | now | Hi {name}, what the app does in 3 steps (create a project → connect a social → compose/schedule). Button: *Verify email* (if unverified, link with a 48 h verify token in `payload_secret`) or *Open the app* |
| 2 | `social_connected` | OAuth callback / pickers after `upsertAccount` succeeds | `<projectId>:<platforms>:<minute>` | now + 1 min | "{Platform(s)} connected to project **{project}**" with account name and avatar. Meta connects Facebook **and** Instagram in one step, so one email lists both. Only for a **new** connection or a reconnect of an expired/disconnected account, not for silent token refreshes. Footer: "Wasn't you? Disconnect it in Connections" |
| 3 | `password_changed` | Settings change, reset, first "set password" | `<unix ms>` | now (kick) | Time, device (user agent), IP. "Wasn't you? Reset your password" button. Sent even if the user unsubscribed from everything |
| 4 | `reset_password` | forgot-password | `<token id>` | now (kick) | Reset button `CLIENT_URL/reset-password?token=…` (raw token only in encrypted `payload_secret`), "expires in 30 minutes", "Didn't ask? Ignore this email". If the token is used or expired before sending → `skipped` |
| 5 | `daily_summary` | `jobs/dailySummary.js` | `<YYYY-MM-DD>` (user's local yesterday) | now | See section 4 |
| 6 | `first_post_nudge` | `jobs/lifecycle.js` | `once` | — | Signed up ≥ 24 h ago and has **no posts at all**. If no social is connected yet: "Connect a social and schedule your first post" (button → Connections). If connected: "You're connected to {platforms}. Schedule your first post" (button → Compose) |
| 7 | `feedback_request` | `jobs/lifecycle.js` | `once` | — | `first_post_published_at` ≥ 3 days ago. "How was your experience?" with five 1–5 rating links (`CLIENT_URL/feedback?t=<signed>&r=4`) → the page saves the rating and offers an optional comment box |
| 8 | `inactive_nudge` | `jobs/lifecycle.js` | `<last_active_at as YYYY-MM-DD>` | — | `last_active_at` < now − 4 days. Shows what's waiting: posts scheduled for the coming days, connections that expire soon, "Your last post went out on {date}". Button → Compose |

Because the dedupe key for email 8 is the date of the last activity, a user gets **one** "we miss you" per inactive stretch. If they come back and go quiet again, a new date means a new email.

### Lifecycle guard rails (emails 6, 7, 8)

- **Max one lifecycle email per user per 24 h.** The job checks `email_outbox` for a `sent` lifecycle row in the last 24 h and waits otherwise. Priority when several are due: 6 → 8 → 7.
- **Not to a user active in the last hour** (they're using the app; the nudge is pointless).
- **Quiet hours:** only enqueue between 09:00 and 20:00 in the user's time zone.
- **Inactive nudge cap:** no more than one every 14 days, and stop after 3 unanswered ones (no activity since). Don't send it before email 6 had its chance (account older than 4 days).
- Disabled users (`users.disabled_at`) and unverified email addresses older than 7 days get no lifecycle mail (protects the Gmail sender reputation).
- Respect `email_prefs`: `productTips` controls 6 and 8, `feedback` controls 7, `dailySummary` controls 5. Checked at enqueue **and** again at send time (the user may unsubscribe in between → `skipped`).

## 4. Daily summary (email 5)

- **Cron:** `0 * * * *` (every hour on the hour). For each user where **local time is now 09:xx** (`timezone`), build "yesterday" in their zone, `[start, end)` converted to UTC.
- **What counts:** targets of the user's posts (through `projects.user_id`) with `posts.scheduled_at IS NOT NULL` and `post_targets.finished_at` inside yesterday, status `published` or `failed`.
- **Nothing went out → no email** (no row is enqueued).
- **Content:**
  - Headline: "Yesterday: 5 scheduled posts went out (1 failed)".
  - One block per project (name + color dot), one line per post: time, type, first 80 chars of the caption, platform chips with ✓ (link to `external_url`) or ✗ (short error + *Retry* link to `CLIENT_URL/history/<id>`).
  - "Coming up today": count of posts scheduled for today, with the next 3.
- **Catch-up:** if the server was down at 09:00, the next hourly run up to 12:00 local still sends it (the job looks for users at 09:00–11:59 who have no row for that date yet). After that the day is skipped.

## 5. Sender

- `setInterval(30 s)` plus `kick()`. Each run:
  1. Clear stale locks (`locked_at` older than 5 min, status `sending` → `queued`).
  2. Pick up to `EMAIL_BATCH` (default 10) rows: `status='queued' AND send_after <= now AND (next_attempt_at IS NULL OR next_attempt_at <= now)` ordered by `priority, id`. Claim each with `UPDATE … SET status='sending', locked_at=NOW() WHERE id=? AND status='queued'` (affected rows = 1 means we own it).
  3. Load the user. Re-check: user exists and is not disabled, preference still on, rule still true (e.g. reset token still valid, first post still missing). If not → `skipped` with a reason.
  4. Render → `mailer.sendMail` → `sent`, store `message_id`, wipe `payload_secret`.
  5. Error: SMTP 5xx (bad address, rejected) → `failed` right away. Network / 4xx / timeout → `attempts+1`, backoff 1 min, 5 min, 30 min, 2 h, 6 h; after 5 attempts → `failed`. Security emails older than 1 h are not retried (a reset link from yesterday is useless) → `failed`.
- **Rate limit (Gmail):** at most `EMAIL_MAX_PER_MINUTE` (default 20) and `EMAIL_MAX_PER_DAY` (default 450; Gmail allows about 500). When the day cap is hit, only priority 1–2 keep going; digest and lifecycle wait for the next day.
- **One SMTP connection pool** (`pool: true, maxConnections: 2`) reused across sends.
- Headers on optional emails: `List-Unsubscribe: <https://…/api/email/unsubscribe?t=…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (Gmail shows its own unsubscribe button).

## 6. API and client

### Server routes

| Method | Route | Auth | Does |
|---|---|---|---|
| GET | `/api/account/notifications` | user | Current `email_prefs` + `timezone` |
| PATCH | `/api/account/notifications` | user | Update prefs and time zone (validated against `Intl.supportedValuesOf('timeZone')`) |
| GET/POST | `/api/email/unsubscribe?t=…` | signed token | One-click unsubscribe from one category (or all optional ones). Token = HMAC-SHA256(`userId:category`) with a new `EMAIL_LINK_SECRET`, no expiry |
| POST | `/api/email/feedback` | signed token | `{ t, rating, comment? }` from the feedback page |
| GET | `/api/dev/emails/:type/preview` | user, **dev only** (`NODE_ENV !== 'production'`) | Renders a template with sample data in the browser |
| POST | `/api/dev/emails/:type/send` | user, dev only | Sends that template to yourself now (bypasses dedupe) |

Plus a CLI for testing: `npm run email:test --prefix server -- --to you@example.com --type daily_summary`.

### Client

- **Settings → Notifications** section: toggles for *Daily summary*, *Tips and reminders* (6 and 8), *Feedback requests* (7), and a *Time zone* dropdown. Security emails are listed as "always on" (greyed out).
- **`/feedback`** public page: reads `t` and `r`, saves the rating at once, shows "Thanks!" and an optional comment box.
- **`/unsubscribed`** public page: "You won't get {category} emails anymore. [Undo]".
- **Sign-up:** sends the browser time zone with the signup request.

## 7. Env (`server/.env`, placeholders in `.env.example`, documented in `03-env-config.md`)

```
# ── Email engine (plans/09-email-engine.md) ───────
EMAIL_ENGINE_ENABLED=true
# Signs unsubscribe and feedback links. Generate once: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
EMAIL_LINK_SECRET=
EMAIL_BATCH=10
EMAIL_MAX_PER_MINUTE=20
EMAIL_MAX_PER_DAY=450
# Local hour for the daily summary (0-23)
EMAIL_DIGEST_HOUR=9
# Days without activity before the "we miss you" email
EMAIL_INACTIVE_DAYS=4
# Dev: true = log emails to the console instead of sending
EMAIL_DRY_RUN=false
```

SMTP values come from plan 08 (`SMTP_HOST`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME`) and live only in `server/.env`.

New dependency: `node-cron`. (`nodemailer` comes from plan 08.)

## 8. Build phases

### Phase E1: Outbox + sender
- [x] Migration (`email_outbox`, `email_feedback`, user columns), models
- [x] `outbox.enqueue/kick`, `sender.js` with locking, retries, rate limits, dry-run
- [x] `engine.js` started from `server.js`; `EMAIL_ENGINE_ENABLED`

**Done when:** enqueueing the same `(user, type, key)` twice leaves one row; with `EMAIL_DRY_RUN=true` the email is printed; with SMTP on, it arrives in Gmail; killing the server mid-send and restarting sends it once (stale lock recovered).

### Phase E2: Templates + preview
- [x] `layout.js` and the 8 templates (HTML + text)
- [x] Dev preview and send-to-myself routes, `email:test` script

**Done when:** every template previews in the browser with sample data, looks right in Gmail on desktop and on a phone, and the text version reads fine.

### Phase E3: Transactional emails (1–4)
- [x] Welcome (with verify button) on email and LinkedIn sign-up
- [x] Social connected from the OAuth callbacks and pickers (one email for Facebook + Instagram)
- [x] Password changed and Forgot password through the outbox with `kick()`; reset token encrypted in `payload_secret`, wiped after send

**Done when:** each action sends its email within a few seconds; a token refresh does **not** send "connected"; the reset email works once and `payload_secret` is NULL afterwards.

### Phase E4: Daily summary (5)
- [x] `users.timezone` (signup + Settings), `jobs/dailySummary.js` hourly with catch-up until 12:00 local
- [x] `first_post_published_at` set by the worker

**Done when:** with test posts scheduled yesterday (one published, one failed), the 09:00 run sends one summary with both and a Retry link; a user with nothing yesterday gets nothing; running the job twice sends once.

### Phase E5: Lifecycle (6, 7, 8) + preferences
- [x] `last_active_at` tracking in `loadUser`
- [x] `jobs/lifecycle.js` every 15 min with all guard rails
- [x] Notifications section in Settings, unsubscribe endpoint + page + `List-Unsubscribe` headers
- [x] Feedback page + `email_feedback`

**Done when:** (set the clock forward in a test DB) a user with no post gets the nudge after 24 h exactly once; a user with a published post gets the feedback email after 3 days; a user idle 4 days gets "we miss you" once, and again only after coming back and going idle again; turning a toggle off stops that email even if it's already queued.

## 9. Risks and edge cases

| Case | Handling |
|---|---|
| Gmail daily limit | `EMAIL_MAX_PER_DAY` with priority: security mail keeps flowing, digests/nudges wait. If the user base grows, switch `SMTP_*` to a provider (SES, Postmark, Brevo); no code change |
| Gmail marks mail as spam | Plain, consistent From; text + HTML parts; `List-Unsubscribe`; no lifecycle mail to unverified addresses; no link shorteners |
| User changes time zone mid-day | The summary dedupe key is the local date, so at most one per date |
| Server down for a day | Summary catch-up window to 12:00 local; lifecycle jobs just run late (conditions are state-based, not "exactly at") |
| Reset token sitting in the DB | Encrypted with `TOKEN_ENCRYPTION_KEY`, wiped after send, row not retried after 1 h |
| User deleted while mail is queued | FK cascade deletes the rows |
| Owner gets nudges right after migration | Backfill `last_active_at` and `first_post_published_at`; pre-insert `welcome`/`first_post_nudge`/`feedback_request` rows as `skipped` for existing users |
| Social connect done by API/MCP (none today) | Only OAuth callbacks enqueue; there is no API path that connects accounts |
| Two server instances | Row claim with `UPDATE … WHERE status='queued'` + dedupe keys; no double sends |

## Later (not in this plan)

- Weekly summary instead of / in addition to daily.
- Per-project summary recipients (e.g. send a client's project summary to the client).
- Email open/click tracking (needs a tracking pixel; skipped on purpose for privacy).
- Admin view of the outbox and feedback scores.
- Moving off Gmail SMTP to a transactional provider with bounce webhooks.
