# 01: Database (MySQL + Sequelize)

- **Host:** `localhost:3306`, **user:** `root`, **password:** stored in `server/.env` (see `03-env-config.md`)
- **Database name:** `social_automations` (charset `utf8mb4`, collation `utf8mb4_unicode_ci` so emojis in captions work)
- **Schema changes:** made only through `sequelize-cli` migrations, never `sync({ alter: true })`
- Timestamps are stored in UTC (`timezone: '+00:00'` in the Sequelize config)

## Tables

### `projects`
A brand/channel. Each project has its own connected accounts and posts (see `04-projects.md`).

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| name | VARCHAR(100) | UNIQUE |
| color | VARCHAR(16) | Hex accent, default `#7c5cff` |
| icon | VARCHAR(32) NULL | |
| description | VARCHAR(500) NULL | |
| settings | JSON NULL | `{ captionFooter, hashtags }`, appended to every caption in this project |
| archived_at | DATETIME NULL | NULL = active |
| created_at / updated_at | DATETIME | |

### `platform_accounts`
One row per connected account per project: LinkedIn profile, YouTube channel, Facebook Page, Instagram account.

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| project_id | INT FK → projects.id ON DELETE CASCADE | |
| platform | ENUM('linkedin','youtube','facebook','instagram') | UNIQUE(project_id, platform): one account per platform per project |
| external_id | VARCHAR(128) | LinkedIn person URN, YT channel ID, FB Page ID, IG user ID |
| display_name | VARCHAR(255) | Shown on the Connections page |
| avatar_url | VARCHAR(1024) NULL | |
| access_token_enc | TEXT | AES-256-GCM ciphertext (iv:tag:data, base64) |
| refresh_token_enc | TEXT NULL | Google only (LinkedIn/Meta: none for this setup) |
| token_expires_at | DATETIME NULL | NULL = doesn't expire (FB Page token) |
| scopes | VARCHAR(1024) | Space-separated scopes that were granted |
| meta | JSON NULL | Extra data, e.g. `{ "pageId": "...", "igUserId": "..." }` |
| status | ENUM('connected','expired','error') | |
| last_checked_at | DATETIME NULL | Last successful token health check |
| created_at / updated_at | DATETIME | |

Index: `(platform, external_id)` to find the same account used in several projects.

### `posts`
One row per thing you compose.

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| project_id | INT FK → projects.id ON DELETE RESTRICT | Index `(project_id, id)` |
| content_type | ENUM('text','image','video','reel','document') | `document` = LinkedIn PDF carousel (07-linkedin-pdf-carousel.md) |
| caption | TEXT | Default caption for all platforms |
| title | VARCHAR(400) NULL | YouTube video title, or the LinkedIn PDF carousel title (max 400) |
| status | ENUM('draft','queued','publishing','completed','partial','failed') | Rolled up from the targets |
| scheduled_at | DATETIME NULL | NULL = publish now (scheduling comes in Phase 6) |
| created_at / updated_at | DATETIME | |

### `media_files`
Files attached to a post. More than one row is possible for image carousels.

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| post_id | INT FK → posts.id ON DELETE CASCADE | |
| position | TINYINT | Order inside a carousel |
| kind | ENUM('image','video','thumbnail','document') | `document` = PDF |
| original_name | VARCHAR(255) | |
| stored_path | VARCHAR(512) | Relative to `server/uploads/` |
| public_token | CHAR(32) | Random token in the public URL (`/media/<token>/<file>`) so URLs can't be guessed |
| mime_type | VARCHAR(100) | |
| size_bytes | BIGINT | |
| width / height | INT NULL | PDFs: page 1 size in points |
| duration_sec | DECIMAL(8,2) NULL | |
| page_count | INT NULL | PDFs only |
| created_at | DATETIME | |

### `post_targets`
One row per post × platform. **This table also acts as the job queue.**

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| post_id | INT FK → posts.id ON DELETE CASCADE | |
| platform | ENUM('linkedin','youtube','facebook','instagram') | UNIQUE(post_id, platform) |
| platform_account_id | INT NULL FK → platform_accounts.id ON DELETE SET NULL | The account this target was queued for |
| overrides | JSON NULL | Per-platform caption, title, privacy, tags, shareToFeed… |
| status | ENUM('pending','uploading','processing','published','failed','skipped') | |
| progress | TINYINT | 0 to 100, for the progress bar |
| attempts | TINYINT DEFAULT 0 | Max 3 automatic attempts |
| next_attempt_at | DATETIME NULL | Backoff time for retries |
| locked_at | DATETIME NULL | Set when the worker claims the row, so two workers never run the same job |
| external_id | VARCHAR(255) NULL | Post/video ID on the platform |
| external_url | VARCHAR(1024) NULL | Link to the live post |
| error_message | TEXT NULL | Readable error message |
| error_raw | JSON NULL | Raw API error response, for debugging |
| started_at / finished_at | DATETIME NULL | |
| created_at / updated_at | DATETIME | |

Index: `(status, next_attempt_at)` for the worker's polling query.

### `oauth_states`
Short-lived CSRF state for OAuth redirects.

| Column | Type | Notes |
|---|---|---|
| state | CHAR(64) PK | Random value |
| platform | ENUM(...) | |
| code_verifier | VARCHAR(128) NULL | PKCE (used for Google) |
| project_id | INT NULL | Project the OAuth flow is connecting into |
| created_at | DATETIME | The callback rejects states older than 10 minutes |

### `activity_logs` (optional but useful)
| Column | Type | Notes |
|---|---|---|
| id | BIGINT PK AI | |
| post_target_id | INT NULL FK | |
| level | ENUM('info','warn','error') | |
| message | VARCHAR(1024) | e.g. "IG container status: IN_PROGRESS" |
| data | JSON NULL | |
| created_at | DATETIME | |

## Relationships

```
projects 1───* platform_accounts
projects 1───* posts 1───* media_files
posts 1───* post_targets 1───* activity_logs
post_targets *───1 platform_accounts (one per platform per project; the worker reads it at publish time)
```

## Status roll-up rule (`posts.status`)
- Every target `published` or `skipped` → `completed`
- Some published, some `failed` → `partial`
- Every non-skipped target `failed` → `failed`
- Any target `pending`, `uploading` or `processing` → `publishing`

## Auth tables (plan 08)

- `users` (email unique, email_verified_at, password_hash NULL for social-only, name, phone, avatar_url, last_login_at, disabled_at)
- `user_identities` (user_id, provider linkedin|facebook|instagram, provider_user_id; UNIQUE provider+provider_user_id and user_id+provider)
- `user_sessions` (user_id, token_hash sha256 UNIQUE, expires_at, last_seen_at, user_agent, ip)
- `auth_tokens` (user_id, purpose reset_password|verify_email, token_hash sha256 UNIQUE, expires_at, used_at)
- `auth_oauth_states` (state, provider, code_verifier, nonce, mode login|link, user_id)

Changed: `projects.user_id` NOT NULL FK (name is now UNIQUE per user: `user_id, name`), `media_files.user_id` FK, `oauth_states.user_id`.
Everything else is owned through `project_id`. Migrations `20261122000001` and `20261122000002` (the second needs env `OWNER_PASSWORD`, then remove it).

## Email engine tables (plan 09)

- `email_outbox` (user_id, type, dedupe_key, to_email, priority, payload JSON, payload_secret encrypted + wiped after send, status, send_after, attempts, next_attempt_at, locked_at, sent_at, message_id, error; UNIQUE(user_id, type, dedupe_key))
- `email_feedback` (user_id UNIQUE, rating 1-5, comment)
- `users` gains `timezone`, `last_active_at`, `email_prefs` JSON, `first_post_published_at`
