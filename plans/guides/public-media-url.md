# Public media URL (needed for Instagram)

Instagram's publishing API **downloads** your image or video from a URL. It won't accept a file from `localhost`, so your local server needs a public HTTPS address.

The server serves media at:
```
GET /media/<public_token>/<filename>
```
Only this path is exposed. `public_token` is a random 32-character value per file, so URLs can't be guessed. **Only `/media/*` should be reachable from outside. Don't tunnel the `/api` routes publicly.** If the tunnel tool can't restrict paths, the server rejects non-`/media` requests that arrive with the tunnel's `Host` header.

## Option A: Cloudflare Tunnel (recommended, free, stable URL with a domain)

**Quick, no account (URL changes each time):**
```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:5000
```
It prints `https://<random>.trycloudflare.com`. Put that into `PUBLIC_BASE_URL` and restart the server.

**Stable URL (needs a domain on Cloudflare):**
```powershell
cloudflared tunnel login
cloudflared tunnel create social-media
cloudflared tunnel route dns social-media media.yourdomain.com
cloudflared tunnel run --url http://localhost:5000 social-media
```
`PUBLIC_BASE_URL=https://media.yourdomain.com`. This URL never changes.

## Option B: ngrok

```powershell
winget install ngrok.ngrok
ngrok config add-authtoken <token from dashboard.ngrok.com>
ngrok http 5000
```
The free plan includes one static domain (`ngrok http --url=<your-static>.ngrok-free.app 5000`).
⚠️ The free ngrok plan shows an interstitial warning page to browsers. Meta's fetcher usually gets the file anyway, but if downloads fail, use Cloudflare.

## Option C: No tunnel (upload to cloud storage)
Upload the media to S3, Cloudflare R2 or Cloudinary, and pass that URL to Instagram. This means more setup, and the files leave your machine. Use it only if tunnels aren't an option.

## Option D: Videos only (resumable upload)
IG Reels can be created with `upload_type=resumable`, pushing the bytes directly to `rupload.facebook.com`, so no public URL is needed for **videos**. Images still need a URL. The plan uses this for videos when `PUBLIC_BASE_URL` isn't set.

## Check it works
Open `https://<tunnel>/media/<token>/<file>.jpg` on your **phone with Wi-Fi off**. If the image loads, Instagram can fetch it too.

## Which platforms need this
| Platform | Needs public URL? |
|---|---|
| Instagram | **Yes** for images. Videos: no if using resumable upload |
| Facebook | No (direct multipart / rupload) |
| LinkedIn | No (direct PUT upload) |
| YouTube | No (resumable upload) |
| Meta OAuth redirect | Only if Meta rejects the `http://localhost` redirect |
