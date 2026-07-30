/**
 * Public base URL for screenshots served from the R2 custom-domain CDN.
 * Screenshots are NOT proxied through the Worker — the browser fetches them
 * directly from `https://{IMG_DOMAIN}/{screenshot_key}` so Cloudflare's edge
 * cache serves repeat loads (Class B reads only on cache miss).
 *
 * IMG_DOMAIN is a plain host (no scheme), e.g. "img.example.com" or the
 * bucket's "pub-xxxx.r2.dev". Resolved server-side and passed to the client,
 * so it works both locally and on the Worker without build-time inlining.
 */
export async function getImageDomain(): Promise<string | null> {
  // Cloudflare Worker: vars live on the binding env.
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const d = (getCloudflareContext().env as { IMG_DOMAIN?: string }).IMG_DOMAIN;
    if (d) return d.replace(/^https?:\/\//, "").replace(/\/$/, "");
  } catch {
    /* not on Workers — fall through to process.env */
  }
  const d = process.env.IMG_DOMAIN;
  return d ? d.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
}

/** Build the CDN URL for a screenshot_key, or null if unavailable. */
export function screenshotUrl(
  imgDomain: string | null,
  screenshotKey: string | null | undefined
): string | null {
  if (!imgDomain || !screenshotKey) return null;
  return `https://${imgDomain}/${screenshotKey}`;
}
