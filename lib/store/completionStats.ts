/**
 * Completion telemetry: daily counters keyed by (day, modname, outcome, reason).
 * No user identity, no course or activity ids — only how many activities of a
 * type ended how, and why. One write per /api/run pass, never per activity.
 *
 * Like the footer metrics, this must never break a run and no-ops without a DB.
 */
import { getDb } from "./db";

export type OutcomeTally = Map<string, number>;

/** Keep keys short and boring: they come from Moodle data and our own code. */
function clean(s: string | undefined, fallback: string): string {
  const v = String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
  return v || fallback;
}

/** Add one activity result to a tally (pure; used by the route per event). */
export function tallyOutcome(
  tally: OutcomeTally,
  e: { modname?: string; status: string; reason?: string },
): void {
  const key = [clean(e.modname, "unknown"), clean(e.status, "unknown"), clean(e.reason, "")].join(
    "|",
  );
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

export async function recordOutcomes(tally: OutcomeTally): Promise<void> {
  if (tally.size === 0) return;
  const sql = getDb();
  if (!sql) return;
  const modnames: string[] = [];
  const outcomes: string[] = [];
  const reasons: string[] = [];
  const counts: number[] = [];
  for (const [key, n] of tally) {
    const [m, o, r] = key.split("|");
    modnames.push(m);
    outcomes.push(o);
    reasons.push(r ?? "");
    counts.push(n);
  }
  try {
    await sql`
      INSERT INTO completion_outcomes (day, modname, outcome, reason, n)
      SELECT CURRENT_DATE, t.m, t.o, t.r, t.n
      FROM unnest(${modnames}::text[], ${outcomes}::text[], ${reasons}::text[], ${counts}::bigint[])
        AS t(m, o, r, n)
      ON CONFLICT (day, modname, outcome, reason)
      DO UPDATE SET n = completion_outcomes.n + EXCLUDED.n
    `;
  } catch {
    /* telemetry must never break a run */
  }
}
