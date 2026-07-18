/**
 * Student-posted events. Same anonymity and abuse model as Gists — the only real
 * difference is that events sort by when they happen, not when they were posted.
 */
import { getDb } from "./db";
import { newId } from "./gists";

export const MAX_TITLE = 140;
export const MAX_BODY = 1000;
export const MAX_LOCATION = 140;
export const PAGE_SIZE = 30;

/** An event more than a year out is a typo or a joke, not a plan. */
const MAX_FUTURE_MS = 365 * 24 * 60 * 60 * 1000;

export type MivaEvent = {
  id: string;
  title: string;
  body: string;
  startsAt: number;
  location: string | null;
  link: string | null;
  department: string | null;
  createdAt: number;
  editedAt: number | null;
  authorName: string | null; // poster's handle, or null when anonymous
};

type EventRow = {
  id: string;
  title: string;
  body: string;
  starts_at: string;
  location: string | null;
  link: string | null;
  department: string | null;
  created_at: string;
  edited_at: string | null;
  author_name: string | null;
};

function toPublic(r: EventRow): MivaEvent {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    startsAt: new Date(r.starts_at).getTime(),
    location: r.location,
    link: r.link,
    department: r.department,
    createdAt: new Date(r.created_at).getTime(),
    editedAt: r.edited_at ? new Date(r.edited_at).getTime() : null,
    authorName: r.author_name ?? null,
  };
}

/**
 * Only http(s) links. A `javascript:` or `data:` URL in an href would be stored
 * XSS the moment someone clicks it.
 */
export function normalizeLink(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Returns ms epoch, or null if unusable. */
export function normalizeStartsAt(raw: unknown, now: number): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return null;
  // A little slack for clock skew and "starting now" posts.
  if (t < now - 60 * 60 * 1000) return null;
  if (t > now + MAX_FUTURE_MS) return null;
  return t;
}

export async function createEvent(input: {
  title: string;
  body: string;
  startsAt: number;
  location: string | null;
  link: string | null;
  department: string | null;
  authorHash: string;
  showAuthor: boolean;
  authorName: string | null;
}): Promise<MivaEvent | null> {
  const sql = getDb();
  if (!sql) return null;
  const id = newId();
  const rows = (await sql`
    INSERT INTO events (id, title, body, starts_at, location, link, department, author_hash, show_author)
    VALUES (${id}, ${input.title}, ${input.body},
            ${new Date(input.startsAt).toISOString()}, ${input.location},
            ${input.link}, ${input.department}, ${input.authorHash}, ${input.showAuthor})
    RETURNING id, title, body, starts_at, location, link, department, created_at, edited_at
  `) as EventRow[];
  if (!rows[0]) return null;
  const event = toPublic(rows[0]);
  event.authorName = input.showAuthor ? input.authorName : null;
  return event;
}

/**
 * Upcoming first. `past: true` lists what already happened, newest first — worth
 * keeping visible so the board doesn't look empty between events.
 */
export async function listEvents(opts: {
  department?: string | null;
  past?: boolean;
}): Promise<MivaEvent[]> {
  const sql = getDb();
  if (!sql) return [];
  const department = opts.department ?? null;

  const rows = opts.past
    ? ((await sql`
        SELECT e.id, e.title, e.body, e.starts_at, e.location, e.link, e.department,
               e.created_at, e.edited_at,
               CASE WHEN e.show_author THEN u.username ELSE NULL END AS author_name
          FROM events e
          LEFT JOIN users u ON u.author_hash = e.author_hash
         WHERE NOT e.hidden AND e.starts_at < now()
           AND (${department}::text IS NULL OR e.department = ${department})
         ORDER BY e.starts_at DESC
         LIMIT ${PAGE_SIZE}
      `) as EventRow[])
    : ((await sql`
        SELECT e.id, e.title, e.body, e.starts_at, e.location, e.link, e.department,
               e.created_at, e.edited_at,
               CASE WHEN e.show_author THEN u.username ELSE NULL END AS author_name
          FROM events e
          LEFT JOIN users u ON u.author_hash = e.author_hash
         WHERE NOT e.hidden AND e.starts_at >= now()
           AND (${department}::text IS NULL OR e.department = ${department})
         ORDER BY e.starts_at ASC
         LIMIT ${PAGE_SIZE}
      `) as EventRow[]);
  return rows.map(toPublic);
}

/** Single event for its permalink page. Hidden events read as gone (null). */
export async function getEvent(id: string): Promise<MivaEvent | null> {
  const sql = getDb();
  if (!sql) return null;
  const rows = (await sql`
    SELECT e.id, e.title, e.body, e.starts_at, e.location, e.link, e.department,
           e.created_at, e.edited_at,
           CASE WHEN e.show_author THEN u.username ELSE NULL END AS author_name
      FROM events e
      LEFT JOIN users u ON u.author_hash = e.author_hash
     WHERE e.id = ${id} AND NOT e.hidden
  `) as EventRow[];
  return rows[0] ? toPublic(rows[0]) : null;
}

export async function ownsEvent(id: string, authorHash: string): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  const rows = (await sql`
    SELECT 1 FROM events WHERE id = ${id} AND author_hash = ${authorHash}
  `) as unknown[];
  return rows.length > 0;
}

/**
 * Author-only edit. The author_hash predicate is the authorization; a non-author
 * updates zero rows and gets null, which the route turns into a uniform 404.
 */
export async function updateEvent(
  id: string,
  authorHash: string,
  patch: {
    title: string;
    body: string;
    startsAt: number;
    location: string | null;
    link: string | null;
    department: string | null;
    showAuthor: boolean;
  },
): Promise<MivaEvent | null> {
  const sql = getDb();
  if (!sql) return null;
  // Update-then-refetch so the returned event carries the resolved author name.
  const rows = (await sql`
    UPDATE events
       SET title = ${patch.title}, body = ${patch.body},
           starts_at = ${new Date(patch.startsAt).toISOString()},
           location = ${patch.location}, link = ${patch.link},
           department = ${patch.department}, show_author = ${patch.showAuthor},
           edited_at = now()
     WHERE id = ${id} AND author_hash = ${authorHash} AND NOT hidden
    RETURNING id
  `) as { id: string }[];
  if (!rows[0]) return null;
  return getEvent(id);
}

export async function deleteEvent(id: string, authorHash: string): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  const rows = (await sql`
    DELETE FROM events WHERE id = ${id} AND author_hash = ${authorHash}
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}