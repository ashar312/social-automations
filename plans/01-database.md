# 01: Database (MySQL + Sequelize)

- **Host:** `localhost:3306`, **user:** `root`, **password:** stored in `server/.env` (see `03-env-config.md`)
- **Database name:** `social_automations` (charset `utf8mb4`, collation `utf8mb4_unicode_ci` so emojis in captions work)
- **Schema changes:** made only through `sequelize-cli` migrations, never `sync({ alter: true })`
- Timestamps are stored in UTC (`timezone: '+00:00'` in the Sequelize config)

## Tables

### `platform_accounts`
One row per connected account: LinkedIn profile, YouTube channel, Facebook Page, Instagram account.

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| platform | ENUM('linkedin','youtube','facebook','instagram') | UNIQUE (one account per platform) |
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

### `posts`
One row per thing you compose.

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| content_type | ENUM('text','image','video','reel') | |
| caption | TEXT | Default caption for all platforms |
| title | VARCHAR(255) NULL | Used by YouTube |
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
| kind | ENUM('image','video','thumbnail') | |
| original_name | VARCHAR(255) | |
| stored_path | VARCHAR(512) | Relative to `server/uploads/` |
| public_token | CHAR(32) | Random token in the public URL (`/media/<token>/<file>`) so URLs can't be guessed |
| mime_type | VARCHAR(100) | |
| size_bytes | BIGINT | |
| width / height | INT NULL | |
| duration_sec | DECIMAL(8,2) NULL | |
| created_at | DATETIME | |

### `post_targets`
One row per post × platform. **This table also acts as the job queue.**

| Column | Type | Notes |
|---|---|---|
| id | INT PK AI | |
| post_id | INT FK → posts.id ON DELETE CASCADE | |
| platform | ENUM('linkedin','youtube','facebook','instagram') | UNIQUE(post_id, platform) |
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
posts 1───* media_files
posts 1───* post_targets 1───* activity_logs
platform_accounts (one per platform; the worker reads it at publish time)
```

## Status roll-up rule (`posts.status`)
- Every target `published` or `skipped` → `completed`
- Some published, some `failed` → `partial`
- Every non-skipped target `failed` → `failed`
- Any target `pending`, `uploading` or `processing` → `publishing`
