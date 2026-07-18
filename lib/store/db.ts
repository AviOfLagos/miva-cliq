/**
 * Neon Postgres handle (provisioned through the Vercel Marketplace).
 *
 * Returns null when the env isn't configured — local dev and preview builds
 * without the integration should degrade quietly (Gists and Events empty,
 * metrics hidden) rather than crash. Every caller must handle null.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

let client: Sql | null | undefined;

function connectionString(): string {
  // Neon's Vercel integration injects several aliases depending on setup.
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ""
  );
}

export function getDb(): Sql | null {
  if (client !== undefined) return client;
  const url = connectionString();
  // Next.js patches global fetch and caches it by default. The neon HTTP driver
  // runs every query over fetch, so without this the same SELECT is served from
  // Next's cache and reads go stale immediately after a write (a post wouldn't
  // show up, /api/me wouldn't reflect a just-set username). `no-store` opts every
  // query out of that cache — correctness over the tiny per-query saving.
  client = url
    ? (neon(url, { fetchOptions: { cache: "no-store" } }) as Sql)
    : null;
  if (!client && process.env.NODE_ENV !== "production") {
    console.warn(
      "[miva-cliq] No Postgres connection string — Gists, Events and metrics are disabled.",
    );
  }
  return client;
}

export function storeEnabled(): boolean {
  return getDb() !== null;
}