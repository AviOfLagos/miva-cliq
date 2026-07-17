/**
 * Footer metrics. Two honest numbers: how many distinct people have logged in,
 * and how many runs have been started.
 *
 * Unique users are counted with a HyperLogLog over the salted author hash — it
 * dedupes without ever holding a list of who logged in.
 */
import { getRedis } from "./redis";
import { authorHash } from "./authorHash";

const USERS_KEY = "metrics:users";
const RUNS_KEY = "metrics:runs";

export async function recordUser(email: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !email) return;
  try {
    await redis.pfadd(USERS_KEY, authorHash(email));
  } catch {
    /* metrics must never break a login */
  }
}

export async function recordRun(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.incr(RUNS_KEY);
  } catch {
    /* metrics must never break a run */
  }
}

export async function readMetrics(): Promise<{ users: number; runs: number }> {
  const redis = getRedis();
  if (!redis) return { users: 0, runs: 0 };
  try {
    const [users, runs] = await Promise.all([
      redis.pfcount(USERS_KEY),
      redis.get<number>(RUNS_KEY),
    ]);
    return { users: Number(users) || 0, runs: Number(runs) || 0 };
  } catch {
    return { users: 0, runs: 0 };
  }
}