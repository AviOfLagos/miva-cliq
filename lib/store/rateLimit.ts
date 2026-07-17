/**
 * Fixed-window rate limiting for anonymous posting.
 *
 * Deliberately simple: INCR a key, EXPIRE it on first write. A fixed window can
 * let through up to 2x the limit across a boundary, which is fine for spam
 * control on a student forum.
 */
import { getRedis } from "./redis";

export type RateVerdict = { ok: boolean; remaining: number };

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateVerdict> {
  const redis = getRedis();
  if (!redis) return { ok: true, remaining: limit };
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return { ok: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    // Fail open: a Redis blip shouldn't stop people posting.
    return { ok: true, remaining: limit };
  }
}

/** Best-effort client IP from the proxy headers Vercel sets. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}