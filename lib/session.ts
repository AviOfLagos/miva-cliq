/**
 * Server-side session sealing. The Moodle session (cookies + sesskey) is
 * AES-256-GCM encrypted with SESSION_SECRET and stored in an httpOnly cookie.
 * The browser never sees the raw Moodle cookies, and we persist nothing on the
 * server — the sealed blob rides in the request cookie.
 *
 * The blob carries its own issue time and `unseal` enforces it. The cookie's
 * `maxAge` cannot do this job: it is a browser-side attribute, so it is gone the
 * moment the raw value is copied out of the jar. Without an expiry inside the
 * ciphertext, a captured blob replays until SESSION_SECRET is rotated.
 */
import crypto from "crypto";
import type { MoodleSession } from "./moodle/auth";

export const SESSION_COOKIE = "mc_session";
const ALG = "aes-256-gcm";

/**
 * How long a sealed session stays valid, server-side. Roughly matches the
 * Moodle session lifetime — past this the downstream calls would fail anyway.
 * Exported so the login route sets the cookie to the same figure; two separate
 * constants would drift.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 2;

/**
 * What actually gets encrypted: the session plus its issue time. The envelope
 * keeps `iat` out of MoodleSession, which describes Moodle's state and has no
 * business carrying our cookie bookkeeping.
 */
type SealedPayload = { s: MoodleSession; iat: number };

function key(): Buffer {
  const secret = process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";
  return crypto.createHash("sha256").update(secret).digest();
}

export function seal(session: MoodleSession): string {
  const payload: SealedPayload = { s: session, iat: Date.now() };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

/**
 * Decrypt and validate. Returns null for anything we won't accept — tampered,
 * malformed, expired, or issued in the future — so every call site's existing
 * "null means logged out" branch covers the new cases without changes.
 */
export function unseal(blob: string | undefined): MoodleSession | null {
  if (!blob) return null;
  try {
    const raw = Buffer.from(blob, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALG, key(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    const payload = JSON.parse(out.toString("utf8")) as Partial<SealedPayload>;

    // Pre-envelope blobs decrypt cleanly but carry no issue time, so we can't
    // tell a fresh one from a month-old one. Reject rather than grandfather:
    // the cost is that everyone logged in at deploy time logs in again once.
    if (typeof payload?.iat !== "number" || !payload.s) return null;

    const age = Date.now() - payload.iat;
    // A future-dated `iat` means a clock jump or a forged payload from someone
    // who has the secret. Either way it isn't a session we should honour.
    if (age < 0 || age > SESSION_MAX_AGE_SECONDS * 1000) return null;

    return payload.s;
  } catch {
    return null;
  }
}
