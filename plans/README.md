# Social Automations: Plans

A personal, single-user tool. You upload text, an image, a video or a reel once, and it is published to:

1. **LinkedIn** (your personal profile)
2. **YouTube** (your channel: videos and Shorts)
3. **Instagram** (Business/Creator account) and **Facebook** (Page)

No logins and no multi-user support. It runs on `localhost` for your own use.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React (Vite) |
| Backend | Node.js (LTS) + Express |
| ORM | Sequelize (+ sequelize-cli migrations) |
| Database | MySQL on localhost (`root` / password in `.env`) |
| Media tools | ffprobe/ffmpeg (read video metadata, make thumbnails) |

## Documents

| File | What's in it |
|---|---|
| [00-architecture.md](00-architecture.md) | System design, folder layout, data flow, what each platform supports |
| [01-database.md](01-database.md) | MySQL schema (tables, columns, statuses) |
| [02-phases.md](02-phases.md) | **The build plan.** Phases, tasks and "done when" checks |
| [03-env-config.md](03-env-config.md) | `.env` variables and where each value comes from |
| [04-projects.md](04-projects.md) | Projects: group connections per channel/brand, each with its own LinkedIn, YouTube, Facebook and Instagram |
| [05-mcp-server.md](05-mcp-server.md) | MCP server: let Claude and other AI tools post, schedule and track posts in a project as tools |
| [06-local-https.md](06-local-https.md) | Run the UI and API on `https://localhost` with a trusted mkcert certificate (needed for Meta OAuth) |
| [guides/linkedin-setup.md](guides/linkedin-setup.md) | Step-by-step LinkedIn app, keys and OAuth setup |
| [guides/youtube-setup.md](guides/youtube-setup.md) | Step-by-step Google Cloud / YouTube Data API setup |
| [guides/meta-instagram-facebook-setup.md](guides/meta-instagram-facebook-setup.md) | Step-by-step Meta app, Facebook Page and Instagram setup |
| [guides/public-media-url.md](guides/public-media-url.md) | Exposing local media over HTTPS, which Instagram requires |
| [guides/webhooks.md](guides/webhooks.md) | Which webhooks exist, and which ones are worth setting up |
| [guides/api.md](guides/api.md) | External API: let other systems post through a project using its project ID + API key |

## Suggested order

1. Read `00-architecture.md` to see the overall shape.
2. **Start the platform guides now.** Some steps take days: LinkedIn product approval, the YouTube audit and Meta account linking.
3. Build following `02-phases.md`.

## Read this before you start: platform limits

- **YouTube:** uploads from an *unaudited* API project are **locked to Private**. You have to apply for the YouTube API audit before uploads can be public or unlisted. The guide covers this.
- **YouTube:** the API has **no text posts** (Community posts aren't available). It accepts video only.
- **Instagram:** the API has **no text-only posts**. Images and videos must be reachable at a **public HTTPS URL** that Instagram downloads from. See `guides/public-media-url.md`.
- **LinkedIn:** personal-use apps don't get refresh tokens, so you **reconnect every 60 days**. The app will warn you before the token expires.
