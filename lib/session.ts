/**
 * Server-side session sealing. The Moodle session (cookies + sesskey) is
 * AES-256-GCM encrypted with SESSION_SECRET and stored in an httpOnly cookie.
 * The browser never sees the raw Moodle cookies, and we persist nothing on the
 * server — the sealed blob rides in the request cookie.
 */
import crypto from "crypto";
import type { MoodleSession } from "./moodle/auth";

export const SESSION_COOKIE = "mc_session";
const ALG = "aes-256-gcm";

function key(): Buffer {
  const secret = process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";
  return crypto.createHash("sha256").update(secret).digest();
}

export function seal(session: MoodleSession): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

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
    return JSON.parse(out.toString("utf8")) as MoodleSession;
  } catch {
    return null;
  }
}
