# LinkedIn setup guide

**Goal:** an app that can post text, images and videos to **your personal LinkedIn profile**.

**You end up with:** `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and a redirect URL you've registered.
**Time:** about 15 minutes, plus a short wait while LinkedIn approves the product.

---

## Step 1: Have a LinkedIn Company Page (required to create an app)

LinkedIn requires every developer app to be linked to a Company Page. Posting still goes to your personal profile.

1. If you don't have one, go to https://www.linkedin.com/company/setup/new/
2. Create a simple page (it can be minimal, like "Ashar Tools").
3. You must be an **admin** of the page.

## Step 2: Create the developer app

1. Go to https://www.linkedin.com/developers/apps and click **Create app**.
2. Fill in:
   - **App name:** `Social Automations (personal)`
   - **LinkedIn Page:** the page from Step 1
   - **Privacy policy URL:** optional, but any URL you own works
   - **App logo:** any square image (required)
3. Accept the terms and click **Create app**.
4. **Verify the app with the page:** in the **Settings** tab, click **Verify** to generate a link. Open the link while logged in as the page admin and approve it.

## Step 3: Add the products (this gives you the scopes)

On the **Products** tab, request:

| Product | Scopes it grants | Why |
|---|---|---|
| **Sign In with LinkedIn using OpenID Connect** | `openid`, `profile`, `email` | Gets your member ID (`sub`), which is used as the post author |
| **Share on LinkedIn** | `w_member_social` | Create posts, upload images and videos as you |

Both are self-serve and usually approved instantly or within minutes. Check the **Auth** tab, which lists the scopes your app has.

> Posting **as the Company Page** (`w_organization_social`) needs the *Community Management API* product, which requires a business application review. This plan posts to your **personal profile** only.

## Step 4: Get keys and set the redirect URL

1. Open the **Auth** tab.
2. Copy the **Client ID** into `LINKEDIN_CLIENT_ID` and the **Primary Client Secret** into `LINKEDIN_CLIENT_SECRET`.
3. Under **OAuth 2.0 settings → Authorized redirect URLs for your app**, add:
   ```
   http://localhost:5000/api/oauth/linkedin/callback
   ```
   It must match `LINKEDIN_REDIRECT_URI` exactly.

## Step 5: Test the OAuth flow by hand (optional, to check the setup before coding)

1. Open this in a browser (replace CLIENT_ID):
   ```
   https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A5000%2Fapi%2Foauth%2Flinkedin%2Fcallback&state=test123&scope=openid%20profile%20email%20w_member_social
   ```
2. Approve. The browser goes to `localhost:5000/...?code=XXXX`. The page fails to load because the server isn't built yet. Copy the `code` from the address bar.
3. Exchange the code within 30 minutes (PowerShell):
   ```powershell
   curl.exe -X POST https://www.linkedin.com/oauth/v2/accessToken `
     -d grant_type=authorization_code -d code=XXXX `
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET `
     -d redirect_uri=http://localhost:5000/api/oauth/linkedin/callback
   ```
   The response contains `access_token` and `expires_in` (≈ 5,184,000 s = 60 days).
4. Get your member ID:
   ```powershell
   curl.exe -H "Authorization: Bearer ACCESS_TOKEN" https://api.linkedin.com/v2/userinfo
   ```
   `sub` is your ID, so the author URN is `urn:li:person:<sub>`.

If you get this far, LinkedIn is set up.

## Token lifetime

- Access token: **60 days**.
- **Refresh tokens are not issued** to standard self-serve apps. They're only for approved partners.
- What to do: the app stores `token_expires_at` and warns you about 7 days before. Click **Reconnect**. It takes one click if you're still logged in to LinkedIn.

## API notes for development

- Base: `https://api.linkedin.com/rest/...`
- Required headers on every `/rest` call:
  - `Authorization: Bearer <token>`
  - `LinkedIn-Version: YYYYMM` (e.g. `202611`). Versions are supported for about a year, so bump it periodically.
  - `X-Restli-Protocol-Version: 2.0.0`
- Endpoints used: `/rest/posts`, `/rest/images?action=initializeUpload`, `/rest/videos?action=initializeUpload|finalizeUpload`
- Video limits (member posts): 3s to 30 min, up to about 500 MB (check the current docs)
- Rate limits are generous for personal use (daily per-member limits on posts). Check the **Analytics** tab of your app.

## Webhooks

LinkedIn doesn't offer webhooks to self-serve apps. Publishing is synchronous, and video status is checked by polling, so you don't need them.

## Troubleshooting

| Error | Fix |
|---|---|
| `unauthorized_scope_error` | The product isn't approved yet, or the scope is misspelled. Check the Auth tab |
| `redirect_uri mismatch` | The URL in the Auth tab must match the env value exactly (http vs https, trailing slash) |
| `426 / version not supported` | Bump `LINKEDIN_API_VERSION` |
| `401` after ~60 days | Token expired. Reconnect |
