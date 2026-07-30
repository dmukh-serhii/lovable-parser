# Serving screenshots from R2 via the Cloudflare CDN

Screenshots live in the R2 bucket `lovable-parser-screenshots` under the key
`screenshots/<domain>.webp`. They are served **directly from a Cloudflare
custom domain** (edge-cached), not proxied through the Worker. Once a domain is
attached, the browser fetches `https://<IMG_DOMAIN>/screenshots/<domain>.webp`
and Cloudflare's cache answers repeat loads — R2 Class B (read) operations only
happen on a cache miss.

Domain attachment is done in the dashboard (not in code). Do this once.

## 1. Enable public access on the bucket

Cloudflare dashboard → **R2 Object Storage** → **lovable-parser-screenshots** →
**Settings**.

Two options under **Public access**:

- **Custom Domain (recommended)** — real CDN caching, your own hostname.
- **r2.dev subdomain** — quick public URL `https://pub-<hash>.r2.dev`, but it is
  rate-limited and **not** meant for production traffic. Fine for a first test.

## 2. Attach a custom domain (recommended)

Under **Settings → Custom Domains → Connect Domain**:

1. Enter a hostname on a domain already in your Cloudflare account, e.g.
   `images.yourdomain.com`.
2. Cloudflare creates the DNS record and provisions a certificate (a minute or
   two). Wait until status shows **Active**.
3. Caching is on by default for custom domains — objects keep the
   `Cache-Control: public, max-age=31536000, immutable` header we set at upload,
   so the edge caches them for a year.

Your `IMG_DOMAIN` is that hostname, **without** the scheme:

```
IMG_DOMAIN=images.yourdomain.com
```

(If you only enabled the r2.dev subdomain instead, use `IMG_DOMAIN=pub-<hash>.r2.dev`.)

## 3. Point the app at it

- **Local dev**: set `IMG_DOMAIN=` in the repo-root `.env`.
- **Cloudflare Worker**: set it in `admin/wrangler.jsonc` under `vars.IMG_DOMAIN`
  (it is a public value, not a secret), then redeploy with `npm run cf:deploy`.

The app builds every thumbnail as `https://<IMG_DOMAIN>/<screenshot_key>`. If a
row has no `screenshot_key` (e.g. a not-found/failed crawl), the placeholder
tile is shown instead.

## 4. Verify the edge cache

```
curl -sI "https://<IMG_DOMAIN>/screenshots/3hh.lovable.app.webp"
```

- First request: `cf-cache-status: MISS` (or `DYNAMIC`), then a repeat request
  should show **`cf-cache-status: HIT`**.
- Confirm `content-type: image/webp` and
  `cache-control: public, max-age=31536000, immutable`.

## Notes

- No Worker CPU is spent on images — they never touch the Worker.
- Re-running `scripts/upload_screenshots_r2.py` uploads only new/changed objects.
- New screenshots from future crawls: run `prepare_screenshots.py` then
  `upload_screenshots_r2.py` again; the immutable cache means a changed shot
  needs a new object (same key overwrites; purge the edge cache or key by a
  content hash if you expect frequent re-captures).
