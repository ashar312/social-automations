# Webhooks: what exists and whether you need them

**Short answer: none are required for publishing.** Every platform returns a result right away or exposes a status you can poll (LinkedIn video status, IG container status, FB video status, the YouTube upload response). The app polls.

Webhooks are only useful for **extra features**, like getting notified about new comments. They're all optional (Phase 6).

| Platform | Webhooks available to you? | Useful for |
|---|---|---|
| LinkedIn | ❌ Not for self-serve apps | n/a |
| YouTube | ✅ PubSubHubbub (new or updated videos on a channel) | Detecting uploads made outside this app |
| Facebook Page | ✅ Meta Webhooks (`feed`: comments, reactions, posts) | Comment notifications |
| Instagram | ✅ Meta Webhooks (`comments`, `mentions`) | Comment notifications |

Every webhook needs a **public HTTPS URL** (the same tunnel as in [public-media-url.md](public-media-url.md)). This time you expose `/webhooks/*` as well.

---

## Meta (Facebook + Instagram) webhooks

1. Add to `.env`: `META_WEBHOOK_VERIFY_TOKEN=<any random string>`
2. The server implements:
   - `GET /webhooks/meta`: if `hub.mode=subscribe` and `hub.verify_token` matches, respond with `hub.challenge` (plain text)
   - `POST /webhooks/meta`: check the `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body with `META_APP_SECRET`), then handle the event and respond 200 quickly
3. In the app dashboard → **Webhooks** (or under your use case):
   - Object **Page**: Callback URL `https://<tunnel>/webhooks/meta`, Verify token = your value → **Verify and save** → subscribe to `feed`
   - Object **Instagram**: same URL → subscribe to `comments`, `mentions`
4. Subscribe the Page to your app (one-time call using the Page token):
   `POST /{page-id}/subscribed_apps?subscribed_fields=feed`
5. In Development mode, webhooks only deliver events for content from users with app roles, which is fine for testing.

## YouTube PubSubHubbub

1. Subscribe: `POST https://pubsubhubbub.appspot.com/subscribe` with
   - `hub.mode=subscribe`
   - `hub.topic=https://www.youtube.com/xml/feeds/videos.xml?channel_id=<YOUR_CHANNEL_ID>`
   - `hub.callback=https://<tunnel>/webhooks/youtube`
   - `hub.verify=async`, optional `hub.secret` (enables an HMAC signature)
2. `GET /webhooks/youtube` → echo `hub.challenge`.
3. `POST /webhooks/youtube` → Atom XML with the video ID.
4. Subscriptions expire (lease ≈ 5 to 10 days). Re-subscribe on a timer.

## Recommendation
Skip webhooks until everything in Phases 1 to 5 works. Add Meta comment webhooks later if you want a "new comments" inbox.
