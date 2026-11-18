# Meta setup guide (Facebook Page + Instagram)

**Goal:** post to your **Facebook Page** and your **Instagram Professional account** through one Meta app and one login.

**You end up with:** `META_APP_ID`, `META_APP_SECRET`, a registered redirect URI, and an IG account linked to your Page.
**Time:** about 30 to 45 minutes. Meta's UI moves things around often, so menu names may differ a bit.

> **Why a Facebook Page?** The *Instagram API with Facebook Login* publishes through the Page that's linked to the IG account, and the same token also posts to the Page. That gives you **both platforms from one connection**. You can't post to a personal Facebook profile through the API. Only Pages are supported.

---

## Step 1: Make Instagram a Professional account

1. In the Instagram app: **Settings → Account type and tools → Switch to professional account**.
2. Choose **Creator** or **Business**. Both work with the publishing API.

## Step 2: Have a Facebook Page and link Instagram to it

1. If you don't have a Page: https://www.facebook.com/pages/create
2. Link IG to the Page, using either:
   - **Facebook:** Page → **Settings → Linked accounts → Instagram → Connect**, or
   - **Meta Business Suite:** https://business.facebook.com → Settings → Accounts → Instagram accounts → Add.
3. Confirm: in Business Suite, the Page and the IG account should appear together.

## Step 3: (Recommended) Meta Business portfolio
1. https://business.facebook.com → create a Business portfolio if you don't have one.
2. Make sure the Page and the IG account are assets in it, and that you have full control.

## Step 4: Create the Meta app

1. Go to https://developers.facebook.com/apps → **Create app**.
   - First time: register as a developer (verify your phone number).
2. **App name:** `Social Automations Personal`, contact email: yours.
3. **Use case:** pick **Other → App type: Business**. In the newer flow, you can instead add these use cases:
   - *"Manage everything on your Page"*
   - *"Manage messaging & content on Instagram"*, choosing **API setup with Facebook login**
4. Connect it to your Business portfolio if asked, then **Create app**.

## Step 5: Add products and permissions

1. Add the product **Facebook Login for Business** (or "Facebook Login"), and the **Instagram** product (the "with Facebook Login" variant).
2. Under the use cases (or App Review → Permissions and Features), make sure these are added. In **Development mode** they work for you without App Review:

| Permission | Why |
|---|---|
| `pages_show_list` | List your Pages |
| `pages_read_engagement` | Read Page info and links |
| `pages_manage_posts` | Post text, photos and videos to the Page |
| `instagram_basic` | Read the IG account ID and username |
| `instagram_content_publish` | Publish IG images, carousels and reels |
| `business_management` | Needed when the Page/IG belong to a Business portfolio |

> **Development mode is fine for personal use.** Anyone with a role on the app (you, as admin) can use every permission without App Review. Don't switch to Live mode unless you need to. Live mode requires App Review for advanced permissions.

## Step 6: Configure Facebook Login

1. **Facebook Login → Settings**:
   - **Valid OAuth Redirect URIs:** add `http://localhost:5000/api/oauth/meta/callback`. In Development mode, `localhost` redirects are allowed. If Meta rejects the http URL, use your HTTPS tunnel URL (`https://<tunnel>/api/oauth/meta/callback`) instead and update `META_REDIRECT_URI`.
   - Client OAuth login: **On**, Web OAuth login: **On**.
   - If you're using *Facebook Login for Business*, you may need a **Configuration** (with the permissions above, token type "User access token"). The `config_id` then replaces `scope` in the login URL.
2. **App settings → Basic:** copy the **App ID** into `META_APP_ID` and the **App Secret** into `META_APP_SECRET`. Add an App Domain, a Privacy Policy URL (any page you own) and an icon if prompted.

## Step 7: Test with Graph API Explorer (no code needed)

1. Go to https://developers.facebook.com/tools/explorer/
2. Select your app → **User Token** → add the permissions from Step 5 → **Generate Access Token** → in the login dialog, **select your Page and IG account**. This is the most commonly missed step: if you don't select them here, they won't be returned later.
3. Run these:
   - `GET me/accounts` → your Page with `id` and `access_token` (the Page token)
   - `GET {page-id}?fields=instagram_business_account,name` → `instagram_business_account.id` is your **IG user ID**
   - `GET {ig-user-id}?fields=username,profile_picture_url` → confirms IG works
4. Test a real IG image post (any public JPEG URL):
   - `POST {ig-user-id}/media?image_url=https://...jpg&caption=test` → `id` (container)
   - `POST {ig-user-id}/media_publish?creation_id={id}` → it's live

## Step 8: How the app will get long-lived tokens (for reference)

The backend does this automatically in the OAuth callback (Phase 2):

1. Code → **short-lived user token** (~1 to 2 h):
   `GET /oauth/access_token?client_id&client_secret&redirect_uri&code`
2. → **long-lived user token** (~60 days):
   `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token=SHORT`
3. → `GET /me/accounts` using the long-lived token. **The Page token returned does not expire**, as long as you don't change your password, remove the app or lose Page admin rights.
4. That Page token is used for both Facebook Page posts and Instagram publishing.

Check any token at https://developers.facebook.com/tools/debug/accesstoken/. For a Page token, "Expires" should say **Never**.

### Alternative: System User token (never expires, survives password changes)
Business Settings → **Users → System users** → Add (Admin) → **Assign assets** (Page + IG, full control) → **Generate token** for your app with the same permissions → choose "Never" expiry. You can paste it into the app as a manual-token option. It's handy if OAuth gives you trouble.

## Limits and rules to know

- **IG text-only posts:** not supported.
- **IG media URLs:** images (JPEG only) and `video_url` must be **publicly reachable over HTTPS**. Instagram downloads them. See [public-media-url.md](public-media-url.md). Videos can avoid this by using `upload_type=resumable` and pushing the bytes to `rupload.facebook.com`.
- **IG publishing limit:** a rolling 24-hour limit on API-published posts (100 at the time of writing). Check it with `GET {ig-user-id}/content_publishing_limit`.
- **IG Reels:** 3s to 15 min, 9:16 recommended, MP4/MOV H.264 + AAC, ≤ 300 MB *(check the current limits)*.
- **IG containers** expire after 24 hours if not published.
- **FB Page Reels:** 3 to 90 seconds, 9:16, minimum 540×960 *(check the current limits)*.
- **Graph API version:** pin it in `META_GRAPH_VERSION`. Each version is supported for about 2 years.

## Troubleshooting

| Problem | Fix |
|---|---|
| `me/accounts` returns empty | You didn't select the Page in the login dialog. Remove the app at facebook.com/settings → Business Integrations and log in again |
| No `instagram_business_account` | IG isn't Professional, or isn't linked to *this* Page |
| `(#10) Application does not have permission` | Permission not added to the app, or not granted at login |
| `(#200) ... pages_manage_posts` | Re-login and grant it. You must have full control of the Page |
| IG error `2207026` / media download failed | The public URL isn't reachable, isn't HTTPS, or the format isn't supported |
| IG container `status_code: ERROR` | Bad video codec or aspect ratio. Re-encode with ffmpeg (H.264, AAC, 30fps, yuv420p) |
| `9007` "media not ready" | You published before the container reached `FINISHED`. Keep polling |
