# YouTube setup guide (Google Cloud + YouTube Data API v3)

**Goal:** upload videos and Shorts to **your YouTube channel**.

**You end up with:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a registered redirect URI, and an audit request you've submitted.
**Time:** about 20 minutes of setup. The audit takes days to weeks.

---

## Step 0: Have a YouTube channel

1. Sign in at https://youtube.com with the Google account you'll use, and create a channel if you don't have one.
2. Optional but recommended: verify the channel by phone at https://www.youtube.com/verify. This allows videos longer than 15 min and custom thumbnails.

## Step 1: Create a Google Cloud project

1. Go to https://console.cloud.google.com/
2. In the top bar, open the project picker → **New Project** → name it `social-automations` → **Create**.
3. Make sure the new project is selected.

## Step 2: Enable YouTube Data API v3

1. Go to **APIs & Services → Library**.
2. Search for **YouTube Data API v3** → **Enable**.

## Step 3: Configure the OAuth consent screen

In the newer console, this is under **Google Auth Platform** (APIs & Services → OAuth consent screen).

1. **Branding:** app name `Social Automations`, your email as the support and developer contact.
2. **Audience:** user type **External** (personal Gmail accounts can't choose "Internal").
3. **Data access / Scopes:** add
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
4. **Test users:** add your own Google account email.

### ⚠️ Testing mode vs Production (refresh tokens expire)
- While the app's publishing status is **Testing**, **refresh tokens expire after 7 days**. You'd have to reconnect every week.
- To fix this, go to **Audience → Publish app** and set it to **In production**. You don't need Google verification for personal use. Because the app is unverified, the consent screen shows an "unverified app" warning. Click **Advanced → Go to Social Automations (unsafe)**. This is fine, because you're the only user.
- After this, refresh tokens stay valid long term (unless you revoke access or change your password).

## Step 4: Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: `social-automations-local`.
4. **Authorized redirect URIs:** add
   ```
   http://localhost:5000/api/oauth/youtube/callback
   ```
   With local HTTPS ([06-local-https.md](../06-local-https.md)), use `https://localhost:5000/api/oauth/youtube/callback` instead. It must match `GOOGLE_REDIRECT_URI`.
5. **Create**. Copy the **Client ID** into `GOOGLE_CLIENT_ID` and the **Client secret** into `GOOGLE_CLIENT_SECRET`.

## Step 5: Request the API audit (do this early, uploads are private until it passes)

Google rule: **videos uploaded through an unverified API project created after July 28, 2020 are locked to Private.** To publish public or unlisted videos, the project has to pass a compliance audit.

1. Fill in the **YouTube API Services – Audit and Quota Extension Form**: https://support.google.com/youtube/contact/yt_api_form
2. Describe it honestly: *"Personal tool used only by me to upload my own videos to my own channel. Single user, no other users' data is accessed."*
3. You may be asked for screenshots or a screencast of the app and a privacy policy URL. A simple page on GitHub Pages is fine.
4. Until approval, the app forces `privacyStatus: private` (`YOUTUBE_AUDITED=false`). You can manually switch videos to Public in YouTube Studio as a workaround. That's allowed, and you'll probably do it while waiting.

## Step 6: Test the OAuth flow by hand (optional)

1. Open in a browser (replace CLIENT_ID):
   ```
   https://accounts.google.com/o/oauth2/v2/auth?client_id=CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A5000%2Fapi%2Foauth%2Fyoutube%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.upload%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly&access_type=offline&prompt=consent
   ```
2. Approve and copy `code` from the redirected URL.
3. Exchange it:
   ```powershell
   curl.exe -X POST https://oauth2.googleapis.com/token `
     -d code=XXXX -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET `
     -d redirect_uri=http://localhost:5000/api/oauth/youtube/callback `
     -d grant_type=authorization_code
   ```
   The response includes `access_token` (1 hour) and **`refresh_token`**. The refresh token only appears on first consent or when you pass `prompt=consent`.
4. Check the channel:
   ```powershell
   curl.exe -H "Authorization: Bearer ACCESS_TOKEN" "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"
   ```

## Quota

- Default: **10,000 units/day** per project (resets at midnight Pacific time).
- `videos.insert` ≈ **1,600 units**, so about **6 uploads/day**. `thumbnails.set` ≈ 50. Read calls ≈ 1.
- Check it at **APIs & Services → YouTube Data API v3 → Quotas**. You can request more through the same audit form.

## Shorts

The API has no "Short" flag. YouTube classifies an upload as a Short when it is:
- **vertical (9:16) or square**, and
- **≤ 3 minutes**,
- and adding `#Shorts` in the title or description helps.

## What the API can't do

- **No Community (text/image) posts.** Text-only and image posts skip YouTube.
- Scheduling: supported by setting `status.privacyStatus=private` + `status.publishAt` (ISO date). Only works once the project is audited.

## Webhooks (optional)

YouTube offers **PubSubHubbub push notifications** for new uploads on a channel. You'd only need this to detect uploads made outside this app. See [webhooks.md](webhooks.md).

## Troubleshooting

| Error | Fix |
|---|---|
| `redirect_uri_mismatch` | The URI in Credentials must match exactly |
| `access_denied` / "app not verified" blocked | Add yourself as a test user, or publish the app to Production and click "Advanced → Go to…" |
| `invalid_grant` after a week | The app is still in **Testing**. Publish it to Production and reconnect |
| `quotaExceeded` | Wait for the daily reset (midnight PT) |
| Video stuck as Private | Audit not passed yet (expected) |
| `youtubeSignupRequired` | The Google account has no channel. Create one |
