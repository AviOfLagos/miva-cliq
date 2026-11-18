/**
 * "View" an activity: GET its page so Moodle records the view and fires
 * view-based completion. Moodle records the view before it redirects (mod/url,
 * mod/resource), so redirects are NOT followed: following them used to send the
 * request (with no timeout) off to external sites, and one slow link could eat
 * the whole run. The body is never read, so a large file download costs nothing.
 *
 * Only LMS URLs are requested: the session cookie must never go anywhere else.
 */
import { LMS, cookieHeader, type MoodleSession } from "./auth";

export const VIEW_TIMEOUT_MS = 5_000;

export function isLmsUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(LMS).origin;
  } catch {
    return false;
  }
}

/** Returns true when Moodle answered (any status), false on timeout/error/refusal. */
export async function viewActivity(
  session: MoodleSession,
  url: string,
  timeoutMs = VIEW_TIMEOUT_MS,
): Promise<boolean> {
  if (!isLmsUrl(url)) return false;
  try {
    const r = await fetch(url, {
      headers: { cookie: cookieHeader(session.cookies) },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await r.body?.cancel().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
