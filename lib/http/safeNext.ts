/**
 * Where to send the student after login when a "Reconnect to Miva" prompt
 * passed `?next=`. Same-origin paths only: string checks on the raw value are
 * not enough ("/\tevil.com" passes a startsWith("/") check and the URL parser
 * strips the tab into "//evil.com"), so this parses the value exactly as the
 * browser would and compares origins.
 *
 * Returns the path + query to navigate to, or null to stay put.
 * Pure (no `@/` alias, no Next types) so the test runner imports it directly.
 */
export function safeNextPath(next: string | null | undefined, origin: string): string | null {
  if (!next) return null;
  let u: URL;
  try {
    u = new URL(next, origin);
  } catch {
    return null;
  }
  if (u.origin !== new URL(origin).origin) return null;
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return u.pathname + u.search;
}
