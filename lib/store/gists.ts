/**
 * Miva Gists storage.
 *
 * Anonymous to readers: rows carry a salted author hash so we can rate-limit and
 * clean up. `toPublic` is the only way a row becomes a response — author_hash has
 * no path to the wire.
 */
import crypto from "crypto";
import { getDb } from "./db";
import { DEFAULT_CATEGORY } from "@/lib/taxonomy";

export const MAX_BODY = 2000;
export const PAGE_SIZE = 20;
/** Reports needed before a post drops out of the feed. */
export const REPORT_HIDE_THRESHOLD = 3;

export type Gist = {
  id: string;
  body: string;
  category: string;
  department: string | null;
  createdAt: number;
  editedAt: number | null;
  replyCount: number;
};

export type Reply = {
  id: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
};

type GistRow = {
  id: string;
  body: string;
  category: string;
  department: string | null;
  created_at: string;
  edited_at: string | null;
  reply_count: number;
};

type ReplyRow = {
  id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
};

export function newId(): string {
  return crypto.randomBytes(9).toString("base64url");
}

/** Trim, collapse runaway blank lines, enforce length. */
export function normalizeBody(raw: unknown, max = MAX_BODY): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.trim().replace(/\n{4,}/g, "\n\n\n");
  if (!body || body.length > max) return null;
  return body;
}

function toPublic(r: GistRow): Gist {
  return {
    id: r.id,
    body: r.body,
    category: r.category,
    department: r.department,
    createdAt: new Date(r.created_at).getTime(),
    editedAt: r.edited_at ? new Date(r.edited_at).getTime() : null,
    replyCount: Number(r.reply_count) || 0,
  };
}

function toPublicReply(r: ReplyRow): Reply {
  return {
    id: r.id,
    body: r.body,
    createdAt: new Date(r.created_at).getTime(),
    editedAt: r.edited_at ? new Date(r.edited_at).getTime() : null,
  };
}

export async function createGist(input: {
  body: string;
  category: string;
  department: string | null;
  authorHash: string;
}): Promise<Gist | null> {
  const sql = getDb();
  if (!sql) return null;
  const id = newId();
  const rows = (await sql`
    INSERT INTO gists (id, body, category, department, author_hash)
    VALUES (${id}, ${input.body}, ${input.category || DEFAULT_CATEGORY},
            ${input.department}, ${input.authorHash})
    RETURNING id, body, category, department, created_at, edited_at, 0 AS reply_count
  `) as GistRow[];
  return rows[0] ? toPublic(rows[0]) : null;
}

/** Single gist for its permalink page. Hidden posts read as gone (null). */
export async function getGist(id: string): Promise<Gist | null> {
  const sql = getDb();
  if (!sql) return null;
  const rows = (await sql`
    SELECT g.id, g.body, g.category, g.department, g.created_at, g.edited_at,
           (SELECT count(*) FROM replies r WHERE r.gist_id = g.id) AS reply_count
      FROM gists g
     WHERE g.id = ${id} AND NOT g.hidden
  `) as GistRow[];
  return rows[0] ? toPublic(rows[0]) : null;
}

/**
 * True if this author owns the gist. Lets a detail page decide whether to render
 * edit/delete controls without ever exposing the stored hash.
 */
export async function ownsGist(id: string, authorHash: string): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  const rows = (await sql`
    SELECT 1 FROM gists WHERE id = ${id} AND author_hash = ${authorHash}
  `) as unknown[];
  return rows.length > 0;
}

/**
 * Author-only edit. The author_hash predicate is the authorization: a non-author
 * (or a missing id) updates zero rows and gets null, which the route turns into a
 * uniform 404 — we never confirm a post exists to someone who can't edit it.
 */
export async function updateGist(
  id: string,
  authorHash: string,
  patch: { body: string; category: string; department: string | null },
): Promise<Gist | null> {
  const sql = getDb();
  if (!sql) return null;
  const rows = (await sql`
    UPDATE gists
       SET body = ${patch.body}, category = ${patch.category},
           department = ${patch.department}, edited_at = now()
     WHERE id = ${id} AND author_hash = ${authorHash} AND NOT hidden
    RETURNING id, body, category, department, created_at, edited_at,
              (SELECT count(*) FROM replies r WHERE r.gist_id = gists.id) AS reply_count
  `) as GistRow[];
  return rows[0] ? toPublic(rows[0]) : null;
}

/** Author-only delete. Replies cascade via the FK. Returns false if not owner. */
export async function deleteGist(id: string, authorHash: string): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  const rows = (await sql`
    DELETE FROM gists WHERE id = ${id} AND author_hash = ${authorHash}
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

/**
 * Newest first, hidden excluded. `before` is an exclusive upper bound on
 * created_at, so paging is stable even as new posts arrive.
 *
 * The filters are passed as nullable params rather than concatenated SQL — the
 * slugs are validated against the taxonomy at the route, and parameterised here,
 * so there are two independent reasons a crafted slug can't reach the planner.
 */
export async function listGists(opts: {
  category?: string | null;
  department?: string | null;
  before?: number | null;
}): Promise<Gist[]> {
  const sql = getDb();
  if (!sql) return [];
  const category = opts.category ?? null;
  const department = opts.department ?? null;
  const before = opts.before ? new Date(opts.before).toISOString() : null;

  const rows = (await sql`
    SELECT g.id, g.body, g.category, g.department, g.created_at,
           (SELECT count(*) FROM replies r WHERE r.gist_id = g.id) AS reply_count
      FROM gists g
     WHERE NOT g.hidden
       AND (${category}::text IS NULL OR g.category = ${category})
       AND (${department}::text IS NULL OR g.department = ${department})
       AND (${before}::timestamptz IS NULL OR g.created_at < ${before})
     ORDER BY g.created_at DESC
     LIMIT ${PAGE_SIZE}
  `) as GistRow[];
  return rows.map(toPublic);
}

export async function addReply(
  gistId: string,
  body: string,
  authorHash: string,
): Promise<Reply | null> {
  const sql = getDb();
  if (!sql) return null;
  const id = newId();
  try {
    const rows = (await sql`
      INSERT INTO replies (id, gist_id, body, author_hash)
      SELECT ${id}, ${gistId}, ${body}, ${authorHash}
       WHERE EXISTS (SELECT 1 FROM gists WHERE id = ${gistId} AND NOT hidden)
      RETURNING id, body, created_at, edited_at
    `) as ReplyRow[];
    return rows[0] ? toPublicReply(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function listReplies(gistId: string): Promise<Reply[]> {
  const sql = getDb();
  if (!sql) return [];
  const rows = (await sql`
    SELECT id, body, created_at, edited_at FROM replies
     WHERE gist_id = ${gistId}
     ORDER BY created_at ASC
     LIMIT 200
  `) as ReplyRow[];
  return rows.map(toPublicReply);
}

/** Which of these reply ids belong to this author — for rendering edit controls. */
export async function ownedReplyIds(
  gistId: string,
  authorHash: string,
): Promise<string[]> {
  const sql = getDb();
  if (!sql) return [];
  const rows = (await sql`
    SELECT id FROM replies WHERE gist_id = ${gistId} AND author_hash = ${authorHash}
  `) as { id: string }[];
  return rows.map((r) => r.id);
}

export async function updateReply(
  id: string,
  authorHash: string,
  body: string,
): Promise<Reply | null> {
  const sql = getDb();
  if (!sql) return null;
  const rows = (await sql`
    UPDATE replies SET body = ${body}, edited_at = now()
     WHERE id = ${id} AND author_hash = ${authorHash}
    RETURNING id, body, created_at, edited_at
  `) as ReplyRow[];
  return rows[0] ? toPublicReply(rows[0]) : null;
}

export async function deleteReply(id: string, authorHash: string): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  const rows = (await sql`
    DELETE FROM replies WHERE id = ${id} AND author_hash = ${authorHash}
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

/**
 * Report a gist or event. The reports PK makes one-per-person automatic, so a
 * double-click can't bury a post. Past the threshold it drops out of the feed;
 * the row (and its author hash) stays so a repeat offender is still limited.
 */
export async function reportTarget(
  kind: "gist" | "event",
  id: string,
  authorHash: string,
): Promise<{ hidden: boolean; alreadyReported: boolean } | null> {
  const sql = getDb();
  if (!sql) return null;

  const inserted = (await sql`
    INSERT INTO reports (target_kind, target_id, author_hash)
    VALUES (${kind}, ${id}, ${authorHash})
    ON CONFLICT DO NOTHING
    RETURNING target_id
  `) as { target_id: string }[];

  if (!inserted.length) return { hidden: false, alreadyReported: true };

  const counted = (await sql`
    SELECT count(*)::int AS n FROM reports
     WHERE target_kind = ${kind} AND target_id = ${id}
  `) as { n: number }[];
  const reports = counted[0]?.n ?? 0;
  const hidden = reports >= REPORT_HIDE_THRESHOLD;

  // Two statements rather than an interpolated table name — the table is part of
  // the query, not a value, so it can never come from a variable.
  const updated =
    kind === "gist"
      ? ((await sql`UPDATE gists SET reports = ${reports}, hidden = ${hidden}
             WHERE id = ${id} RETURNING id`) as { id: string }[])
      : ((await sql`UPDATE events SET reports = ${reports}, hidden = ${hidden}
             WHERE id = ${id} RETURNING id`) as { id: string }[]);

  if (!updated.length) return null;
  return { hidden, alreadyReported: false };
}