/**
 * Sliding-window rate limiting, backed by a row per action.
 *
 * Fails open: a database blip shouldn't stop people posting. Spam is a nuisance;
 * a dead forum is worse.
 */
import { getDb } from "./db";

export type RateVerdict = { ok: boolean; remaining: number };

export async function rateLimit(
  actor: string,
  kind: string,
  limit: number,
  windowSeconds: number,
): Promise<RateVerdict> {
  const sql = getDb();
  if (!sql) return { ok: true, remaining: limit };
  try {
    const rows = (await sql`
      SELECT count(*)::int AS n
        FROM rate_events
       WHERE actor = ${actor}
         AND kind = ${kind}
         AND created_at > now() - make_interval(secs => ${windowSeconds})
    `) as { n: number }[];
    const used = rows[0]?.n ?? 0;
    if (used >= limit) return { ok: false, remaining: 0 };
    return { ok: true, remaining: limit - used - 1 };
  } catch {
    return { ok: true, remaining: limit };
  }
}

/**
 * How many events of `kind` this actor has in each window (seconds), in one
 * query, for limits with more than one window. Fails open like rateLimit():
 * zeros when there is no database or the query fails.
 */
export async function rateCounts(actor: string, kind: string, windowsSeconds: number[]): Promise<number[]> {
  const sql = getDb();
  const zeros = windowsSeconds.map(() => 0);
  if (!sql || !windowsSeconds.length) return zeros;
  const longest = Math.max(...windowsSeconds);
  try {
    const rows = (await sql`
      SELECT created_at FROM rate_events
       WHERE actor = ${actor}
         AND kind = ${kind}
         AND created_at > now() - make_interval(secs => ${longest})
    `) as { created_at: string | Date }[];
    const now = Date.now();
    const ages = rows.map((r) => (now - new Date(r.created_at).getTime()) / 1000);
    return windowsSeconds.map((w) => ages.filter((a) => a < w).length);
  } catch {
    return zeros;
  }
}

export type Reservation = "reserved" | "limited" | "unavailable";
export type RateWindow = { seconds: number; limit: number };

/**
 * Atomically take one slot under every window, BEFORE the expensive work, so
 * parallel requests cannot all pass a check that is recorded afterwards. One
 * transaction: a per-actor advisory lock serialises concurrent reservations,
 * then a single INSERT ... SELECT ... WHERE count < limit ... RETURNING writes
 * the event only if every window has room. Zero rows = "limited".
 *
 * Unlike rateLimit() this does not pretend to succeed: no database, or a query
 * that throws, is "unavailable", and the caller decides what is still safe.
 */
export async function reserveRateSlot(
  actor: string,
  kind: string,
  windows: [RateWindow, RateWindow],
): Promise<Reservation> {
  const sql = getDb();
  if (!sql) return "unavailable";
  const [a, b] = windows;
  try {
    const results = await sql.transaction([
      sql`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`${kind}:${actor}`}, 0))) AS lock`,
      sql`
        INSERT INTO rate_events (actor, kind)
        SELECT ${actor}, ${kind}
         WHERE (SELECT count(*) FROM rate_events
                 WHERE actor = ${actor} AND kind = ${kind}
                   AND created_at > now() - make_interval(secs => ${a.seconds})) < ${a.limit}
           AND (SELECT count(*) FROM rate_events
                 WHERE actor = ${actor} AND kind = ${kind}
                   AND created_at > now() - make_interval(secs => ${b.seconds})) < ${b.limit}
        RETURNING 1
      `,
    ]);
    const inserted = results[1] as unknown[];
    return Array.isArray(inserted) && inserted.length > 0 ? "reserved" : "limited";
  } catch {
    return "unavailable";
  }
}

/** Record an action against the limit. Call only once the action succeeded. */
export async function recordRateEvent(actor: string, kind: string): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`INSERT INTO rate_events (actor, kind) VALUES (${actor}, ${kind})`;
    // Opportunistic prune so the table doesn't grow forever. Cheap: hits the
    // same index the limit check uses.
    await sql`DELETE FROM rate_events WHERE created_at < now() - interval '2 days'`;
  } catch {
    /* never break a post over bookkeeping */
  }
}

/** Best-effort client IP from the proxy headers Vercel sets. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}