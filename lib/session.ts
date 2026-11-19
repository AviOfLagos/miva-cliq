/**
 * Server-side session sealing. The Moodle session (cookies + sesskey) is
 * AES-256-GCM encrypted with SESSION_SECRET and stored in an httpOnly cookie.
 * The browser never sees the raw Moodle cookies — the sealed blob rides in the
 * request cookie.
 *
 * The blob carries its own issue time and `unseal` enforces it. The cookie's
 * `maxAge` cannot do this job: it is a browser-side attribute, so it is gone the
 * moment the raw value is copied out of the jar. Without an expiry inside the
 * ciphertext, a captured blob replays until SESSION_SECRET is rotated.
 *
 * Since #6 the blob also carries a random session id (`sid`), so logout can
 * revoke it (lib/revocation.ts). `unseal` here is synchronous and does NOT
 * consult the revocation list — routes that can, go through
 * `getLmsSession()` in lib/identity.ts, which does.
 *
 * This is the short-lived credential. The 30-day "who is this" cookie is
 * lib/identity.ts and holds no Moodle material; this one must never outlive
 * SESSION_MAX_AGE_SECONDS.
 */
import type { MoodleSession } from "./moodle/auth";
import { deriveKey, newSessionId, openJson, sealJson, withinAge } from "./seal.ts";

export const SESSION_COOKIE = "mc_session";

/**
 * How long a sealed session stays valid, server-side. Roughly matches the
 * Moodle session lifetime — past this the downstream calls would fail anyway.
 * Exported so the login route sets the cookie to the same figure; two separate
 * constants would drift.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 2;

/**
 * What actually gets encrypted: the session plus its issue time and id. The
 * envelope keeps our bookkeeping out of MoodleSession, which describes
 * Moodle's state. `sid` is optional only because cookies sealed before it
 * existed are still honoured until their own two-hour expiry.
 */
type SealedPayload = { s: MoodleSession; iat: number; sid?: string };

export type OpenedSession = { session: MoodleSession; sid: string | null; iat: number };

// Label-free on purpose: cookies issued before the identity cookie existed
// were sealed with sha256(SESSION_SECRET) and must keep opening.
const key = () => deriveKey("");

export function seal(session: MoodleSession, now = Date.now()): string {
  const payload: SealedPayload = { s: session, iat: now, sid: newSessionId() };
  return sealJson(payload, key());
}

/**
 * Decrypt and validate, keeping the id and issue time. Null for anything we
 * won't accept — tampered, malformed, expired, or issued in the future.
 */
export function unsealDetailed(blob: string | undefined | null, now = Date.now()): OpenedSession | null {
  const payload = openJson(blob, key()) as Partial<SealedPayload> | null;
  // Pre-envelope blobs decrypt cleanly but carry no issue time, so we can't
  // tell a fresh one from a month-old one. Reject rather than grandfather.
  if (!payload || typeof payload !== "object" || !payload.s) return null;
  if (!withinAge(payload.iat, SESSION_MAX_AGE_SECONDS, now)) return null;
  const sid = typeof payload.sid === "string" && payload.sid ? payload.sid : null;
  return { session: payload.s, sid, iat: payload.iat as number };
}

/**
 * The session alone. Null means logged out, so every call site's existing
 * branch covers tampered and expired blobs without changes.
 */
export function unseal(blob: string | undefined | null, now = Date.now()): MoodleSession | null {
  return unsealDetailed(blob, now)?.session ?? null;
}
