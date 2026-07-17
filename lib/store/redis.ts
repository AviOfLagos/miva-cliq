/**
 * Upstash Redis handle (provisioned through the Vercel Marketplace).
 *
 * Returns null when the env isn't configured — local dev and preview builds
 * without the integration should degrade quietly (no metrics, empty Gists)
 * rather than crash. Every caller must handle null.
 */
import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

function readEnv(): { url: string; token: string } | null {
  // Vercel's Upstash integration has used both prefixes over time; accept either.
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  if (!url || !token) return null;
  return { url, token };
}

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const env = readEnv();
  client = env ? new Redis({ url: env.url, token: env.token }) : null;
  if (!client && process.env.NODE_ENV !== "production") {
    console.warn(
      "[miva-cliq] Upstash Redis env not set — Gists and metrics are disabled.",
    );
  }
  return client;
}

export function storeEnabled(): boolean {
  return getRedis() !== null;
}