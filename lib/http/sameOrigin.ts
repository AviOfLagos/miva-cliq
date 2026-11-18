/**
 * CSRF guard for state-changing routes. The session cookie is SameSite=Lax,
 * so a top-level cross-site navigation still carries it; writes must prove the
 * request came from our own pages.
 *
 * Pure (no `@/` alias, no Next types) so the test runner imports it directly.
 */

export interface OriginHeaders {
  origin: string | null;
  secFetchSite: string | null;
  /** x-forwarded-host if present (Vercel), else host. */
  host: string | null;
}

/**
 * True only when the browser says same-origin, or the Origin header's host
 * equals the host the request was served on. Anything else, including a
 * missing Origin with no Sec-Fetch-Site, is rejected.
 */
export function isSameOrigin(h: OriginHeaders): boolean {
  if (h.secFetchSite === "same-origin") return true;
  if (!h.origin || !h.host) return false;
  let originHost: string;
  try {
    originHost = new URL(h.origin).host;
  } catch {
    return false; // "null" or garbage
  }
  const host = h.host.split(",")[0].trim().toLowerCase();
  return originHost.toLowerCase() === host;
}
