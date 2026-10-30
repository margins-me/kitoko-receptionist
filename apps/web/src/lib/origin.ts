/**
 * The origin to build PayPal return/cancel URLs and pay links from: the one the request came in on when it is
 * trusted, else SITE_URL. A dev server on another port (3301, a worktree) then keeps the buyer on that server
 * instead of sending her back to SITE_URL's. Trusted: local hosts (localhost, 127.0.0.1, [::1], *.localhost),
 * SITE_URL's own host, and this Vercel deployment's hosts (VERCEL_URL, VERCEL_BRANCH_URL,
 * VERCEL_PROJECT_PRODUCTION_URL). Anything else (a forged Host header) falls back to SITE_URL.
 */
export function trustedOrigin(candidate: string | null | undefined, env: Record<string, string | undefined>): string | null {
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  const known = new Set(
    [env.SITE_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].flatMap((v) => {
      if (!v?.trim()) return [];
      try {
        return [new URL(/^https?:\/\//.test(v.trim()) ? v.trim() : `https://${v.trim()}`).hostname.toLowerCase()];
      } catch {
        return [];
      }
    }),
  );
  if (!local && !known.has(host)) return null;
  // A public host is only trusted over https.
  if (!local && url.protocol !== "https:") return null;
  return url.origin;
}

/** The request's origin from its headers (server actions): Origin, else the forwarded or plain Host. */
export function originFromHeaders(h: { get(name: string): string | null }): string | null {
  const origin = h.get("origin");
  if (origin && origin !== "null") return origin;
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
