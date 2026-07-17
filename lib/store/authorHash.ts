/**
 * One-way author identity for anonymous Gists and the unique-user metric.
 *
 * We never store an email address or a user id. An HMAC under a server-only
 * salt gives us just enough to rate-limit a spammer and count a person once —
 * and nothing that can be turned back into who they are.
 */
import crypto from "crypto";
import type { MoodleSession } from "@/lib/moodle/auth";

function salt(): string {
  const s = process.env.GISTS_SALT || process.env.SESSION_SECRET;
  if (!s) {
    // Without a salt the hash would be a plain digest of the email — trivially
    // reversible with a wordlist of student addresses. Refuse instead.
    throw new Error("GISTS_SALT (or SESSION_SECRET) must be set");
  }
  return s;
}

function hash(input: string): string {
  return crypto
    .createHmac("sha256", salt())
    .update(input)
    .digest("base64url")
    .slice(0, 22);
}

/** Identity for the unique-user metric, from the address typed at login. */
export function authorHash(email: string): string {
  return hash(`email:${email.trim().toLowerCase()}`);
}

/**
 * Identity for Gists, derived from the sealed session — the email isn't kept
 * there, and there's no reason to widen the session just to hash it.
 *
 * userId is scraped at login and is stable across logins. In the rare case the
 * scrape missed it (userId 0), fall back to the sesskey: still unique, but only
 * for the life of that session, so rate limiting resets on re-login.
 */
export function sessionAuthorHash(session: MoodleSession): string {
  return session.userId > 0
    ? hash(`user:${session.userId}`)
    : hash(`sess:${session.sesskey}`);
}