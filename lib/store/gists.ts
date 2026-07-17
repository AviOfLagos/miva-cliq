/**
 * Miva Gists storage.
 *
 * Anonymous to readers: a post carries a salted author hash so we can
 * rate-limit and clean up, and that hash never leaves the server.
 *
 *   gists:feed          ZSET  score = createdAt ms, member = gistId
 *   gist:<id>           HASH  {id, body, createdAt, authorHash, replyCount, reports}
 *   gist:<id>:replies   LIST  JSON replies, oldest first
 */
import crypto from "crypto";
import { getRedis } from "./redis";

export const MAX_BODY = 2000;
export const PAGE_SIZE = 20;
/** Reports needed before a post drops out of the feed. */
export const REPORT_HIDE_THRESHOLD = 3;

export type Gist = {
  id: string;
  body: string;
  createdAt: number;
  replyCount: number;
};

export type Reply = {
  id: string;
  body: string;
  createdAt: number;
};

/** Anything the reader is allowed to see. Note: no authorHash. */
type StoredGist = Gist & { authorHash: string; reports: number };

const feedKey = "gists:feed";
const gistKey = (id: string) => `gist:${id}`;
const repliesKey = (id: string) => `gist:${id}:replies`;

function newId(): string {
  return crypto.randomBytes(9).toString("base64url");
}

/** Trim, collapse runaway blank lines, enforce length. */
export function normalizeBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.trim().replace(/\n{4,}/g, "\n\n\n");
  if (!body || body.length > MAX_BODY) return null;
  return body;
}

function toPublicGist(h: Record<string, unknown>): Gist | null {
  if (!h || typeof h.id !== "string") return null;
  return {
    id: h.id,
    body: String(h.body ?? ""),
    createdAt: Number(h.createdAt) || 0,
    replyCount: Number(h.replyCount) || 0,
  };
}

export async function createGist(
  body: string,
  authorHash: string,
  now: number,
): Promise<Gist | null> {
  const redis = getRedis();
  if (!redis) return null;
  const id = newId();
  const stored: StoredGist = {
    id,
    body,
    createdAt: now,
    authorHash,
    replyCount: 0,
    reports: 0,
  };
  await redis.hset(gistKey(id), stored as unknown as Record<string, unknown>);
  await redis.zadd(feedKey, { score: now, member: id });
  return { id, body, createdAt: now, replyCount: 0 };
}

export async function listGists(before?: number): Promise<Gist[]> {
  const redis = getRedis();
  if (!redis) return [];
  // Newest first. `before` is an exclusive upper bound on createdAt.
  // With BYSCORE + REV the bounds are (max, min), so we walk down from `before`.
  const max: `(${number}` | "+inf" = before ? `(${before}` : "+inf";
  const ids = (await redis.zrange(feedKey, max, "-inf", {
    byScore: true,
    rev: true,
    offset: 0,
    count: PAGE_SIZE,
  })) as string[];
  if (!ids.length) return [];

  const pipe = redis.pipeline();
  ids.forEach((id) => pipe.hgetall(gistKey(id)));
  const rows = (await pipe.exec()) as (Record<string, unknown> | null)[];

  return rows
    .map((r) => (r ? toPublicGist(r) : null))
    .filter((g): g is Gist => g !== null);
}

export async function getGist(id: string): Promise<Gist | null> {
  const redis = getRedis();
  if (!redis) return null;
  const h = await redis.hgetall<Record<string, unknown>>(gistKey(id));
  return h ? toPublicGist(h) : null;
}

export async function addReply(
  gistId: string,
  body: string,
  now: number,
): Promise<Reply | null> {
  const redis = getRedis();
  if (!redis) return null;
  const exists = await redis.exists(gistKey(gistId));
  if (!exists) return null;
  const reply: Reply = { id: newId(), body, createdAt: now };
  await redis.rpush(repliesKey(gistId), JSON.stringify(reply));
  await redis.hincrby(gistKey(gistId), "replyCount", 1);
  return reply;
}

export async function listReplies(gistId: string): Promise<Reply[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = (await redis.lrange(repliesKey(gistId), 0, 200)) as unknown[];
  const out: Reply[] = [];
  for (const r of raw) {
    // Upstash auto-parses JSON strings; tolerate both shapes.
    const v = typeof r === "string" ? safeParse(r) : (r as Reply);
    if (v && typeof v.id === "string") out.push(v);
  }
  return out;
}

function safeParse(s: string): Reply | null {
  try {
    return JSON.parse(s) as Reply;
  } catch {
    return null;
  }
}

/**
 * Report a post. Past the threshold it drops out of the feed — the hash stays
 * so a repeat offender is still rate-limited.
 */
export async function reportGist(
  id: string,
): Promise<{ reports: number; hidden: boolean } | null> {
  const redis = getRedis();
  if (!redis) return null;
  const exists = await redis.exists(gistKey(id));
  if (!exists) return null;
  const reports = await redis.hincrby(gistKey(id), "reports", 1);
  const hidden = reports >= REPORT_HIDE_THRESHOLD;
  if (hidden) await redis.zrem(feedKey, id);
  return { reports, hidden };
}