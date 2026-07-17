/**
 * Footer metrics. Two honest numbers: how many distinct people have logged in,
 * and how many runs have been started.
 *
 * Unique users are one row per salted hash — an exact count with no list of who.
 */
import { getDb } from "./db";
import { authorHash } from "./authorHash";

export async function recordUser(email: string): Promise<void> {
  const sql = getDb();
  if (!sql || !email) return;
  try {
    await sql`
      INSERT INTO metric_users (author_hash) VALUES (${authorHash(email)})
      ON CONFLICT (author_hash) DO NOTHING
    `;
  } catch {
    /* metrics must never break a login */
  }
}

export async function recordRun(): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO metric_counters (name, value) VALUES ('runs', 1)
      ON CONFLICT (name) DO UPDATE SET value = metric_counters.value + 1
    `;
  } catch {
    /* metrics must never break a run */
  }
}

export async function readMetrics(): Promise<{ users: number; runs: number }> {
  const sql = getDb();
  if (!sql) return { users: 0, runs: 0 };
  try {
    const [users, runs] = await Promise.all([
      sql`SELECT count(*)::int AS n FROM metric_users`,
      sql`SELECT value::int AS n FROM metric_counters WHERE name = 'runs'`,
    ]);
    return {
      users: Number((users[0] as { n?: number })?.n) || 0,
      runs: Number((runs[0] as { n?: number })?.n) || 0,
    };
  } catch {
    return { users: 0, runs: 0 };
  }
}