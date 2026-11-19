/**
 * Best-effort end of the Moodle session itself, so the Moodle cookies inside a
 * copied blob stop working at the LMS too — not only in our own cookie check.
 * This also covers blobs sealed before session ids existed, which the
 * revocation list cannot name.
 *
 * LMS host only, short timeout, every error swallowed: logout must never wait
 * on or fail because of Miva.
 */
import { LMS, cookieHeader, type MoodleSession } from "./auth";

export async function endMoodleSession(session: MoodleSession, timeoutMs = 3000): Promise<void> {
  if (!session.sesskey) return;
  try {
    await fetch(`${LMS}/login/logout.php?sesskey=${encodeURIComponent(session.sesskey)}`, {
      headers: { cookie: cookieHeader(session.cookies || {}) },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    /* ignored: best effort */
  }
}
