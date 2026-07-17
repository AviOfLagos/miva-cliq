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