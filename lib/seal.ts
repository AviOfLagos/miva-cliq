/**
 * AES-256-GCM sealing shared by both cookies (lib/session.ts, lib/identity.ts).
 *
 * Each cookie uses its own key, derived from SESSION_SECRET plus a purpose
 * label, so a blob sealed for one cookie can never be opened as the other —
 * pasting the Moodle session into the identity cookie (or the reverse) fails
 * authentication instead of being parsed. The Moodle session keeps the
 * original, label-free key so cookies issued before this change stay valid.
 *
 * Pure (no `@/` alias, no Next types) so the test runner imports it directly.
 */
import crypto from "crypto";

const ALG = "aes-256-gcm";

export function deriveKey(purpose: string): Buffer {
  const secret = process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";
  const h = crypto.createHash("sha256").update(secret);
  if (purpose) h.update(`\0${purpose}`);
  return h.digest();
}

export function sealJson(payload: unknown, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

/** Decrypt and parse. Null for anything tampered, truncated or malformed. */
export function openJson(blob: string | undefined | null, key: Buffer): unknown {
  if (!blob) return null;
  try {
    const raw = Buffer.from(blob, "base64url");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(out.toString("utf8"));
  } catch {
    return null;
  }
}

/** 128 random bits. The revocation list stores a hash of this, never the id. */
export function newSessionId(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/** Accept an issue time only if it is in the past and within maxAgeSeconds. */
export function withinAge(iat: unknown, maxAgeSeconds: number, now: number): boolean {
  if (typeof iat !== "number" || !Number.isFinite(iat)) return false;
  const age = now - iat;
  // A future-dated `iat` means a clock jump or a forged payload from someone
  // who has the secret. Either way it isn't a session we should honour.
  return age >= 0 && age <= maxAgeSeconds * 1000;
}
