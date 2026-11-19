/**
 * Session revocation (#6): the decision, kept apart from the database so it can
 * be tested without one. The table and queries are lib/store/revocations.ts.
 *
 * Both sealed cookies carry a random session id. Logout writes a hash of each
 * id to `revoked_sessions`; unsealing a cookie whose id is listed fails. The
 * row holds only that hash and two timestamps — no author hash, nothing that
 * links a revoked session to a person.
 *
 * FAILURE POLICY — fail open on reads. If the database is not configured, is
 * unreachable, times out, or the table does not exist yet (it is created by
 * db/schema.sql, which has not been pushed to production at the time of
 * writing), the session is accepted as if it were not revoked. Failing closed
 * would log every student out on a database blip, and the fallback is no worse
 * than before this change: the cookie's own expiry still applies, and logout
 * always clears both cookies in the browser and best-effort ends the Moodle
 * session at the LMS. So during an outage a revoked blob that was copied out
 * before logout keeps working until its expiry — the pre-#6 behaviour — and
 * nothing else changes.
 *
 * Nothing is cached in memory. Serverless instances do not share memory, so a
 * cached "not revoked" on one instance would keep honouring a session another
 * instance just revoked.
 *
 * Pure (no `@/` alias, no Next types) so the test runner imports it directly.
 */
import crypto from "crypto";

/** Hash stored in the table. The raw id never leaves the sealed cookie. */
export function sessionIdHash(sid: string): string {
  return crypto.createHash("sha256").update(`sid:${sid}`).digest("base64url");
}

/** True when the hashed id is on the revocation list. May throw or hang. */
export type RevocationLookup = (sidHash: string) => Promise<boolean>;

export type RevocationVerdict =
  | "accept" // looked up, not revoked
  | "revoked" // looked up, revoked: reject
  | "no-id" // blob predates session ids: cannot be revoked, expires on its own
  | "no-store" // no database configured
  | "fail-open"; // lookup threw or timed out: accepted, see FAILURE POLICY

export async function revocationVerdict(
  sid: string | null | undefined,
  lookup: RevocationLookup | null,
): Promise<RevocationVerdict> {
  if (!sid) return "no-id";
  if (!lookup) return "no-store";
  try {
    return (await lookup(sessionIdHash(sid))) ? "revoked" : "accept";
  } catch {
    return "fail-open";
  }
}

/** The only thing callers need: may this session be used? */
export async function passesRevocation(
  sid: string | null | undefined,
  lookup: RevocationLookup | null,
): Promise<boolean> {
  return (await revocationVerdict(sid, lookup)) !== "revoked";
}

/** Rejects after `ms`, so a hung lookup becomes a fail-open, not a hung request. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("revocation lookup timed out")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
