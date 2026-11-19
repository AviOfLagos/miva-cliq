/**
 * `revoked_sessions` access. The policy (fail open, no caching) lives in
 * lib/revocation.ts; read that before changing anything here.
 */
import { getDb } from "./db";
import { sessionIdHash, withTimeout, type RevocationLookup } from "../revocation";

/** A lookup that is slower than this is treated as unavailable (fail open). */
const LOOKUP_TIMEOUT_MS = 1500;

/**
 * Lookup bound to the configured database, or null when there is none.
 * Deliberately not memoised per id: see "Nothing is cached" in lib/revocation.ts.
 */
export function revocationLookup(): RevocationLookup | null {
  const sql = getDb();
  if (!sql) return null;
  return async (sidHash: string) => {
    const rows = (await withTimeout(
      sql`SELECT 1 FROM revoked_sessions WHERE sid_hash = ${sidHash} LIMIT 1`,
      LOOKUP_TIMEOUT_MS,
    )) as unknown[];
    return rows.length > 0;
  };
}

export type Revocation = { sid: string; expiresAt: number };

/**
 * Record revoked session ids. Idempotent (ON CONFLICT DO NOTHING), and never
 * throws: logout must clear the cookies even if this write fails. Returns
 * whether every row was written, for the caller's information only.
 */
export async function revokeSessions(items: Revocation[]): Promise<boolean> {
  const sql = getDb();
  if (!sql || items.length === 0) return items.length === 0;
  try {
    await withTimeout(
      Promise.all(
        items.map(
          (r) => sql`
            INSERT INTO revoked_sessions (sid_hash, expires_at)
            VALUES (${sessionIdHash(r.sid)}, ${new Date(r.expiresAt).toISOString()})
            ON CONFLICT (sid_hash) DO NOTHING`,
        ),
      ),
      3000,
    );
  } catch {
    return false;
  }
  // Rows past their session's own expiry protect nothing; trim them here so
  // the table stays small without a cron job. Failure is harmless.
  try {
    await withTimeout(sql`DELETE FROM revoked_sessions WHERE expires_at < now()`, 1500);
  } catch {
    /* ignore */
  }
  return true;
}
