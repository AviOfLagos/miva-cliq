/**
 * User handles. The one profile Miva keeps: a chosen display name bound to the
 * internal author_hash (HMAC of the Moodle userId). No password, no email, no
 * signup — the Moodle login is the only credential; this is just the label.
 *
 * A handle is optional. You only get a row here if you choose to post under a
 * name or to reply. Anonymous posting needs none of this.
 */
import { getDb } from "./db";

export const MIN_LEN = 3;
export const MAX_LEN = 20;

// Handles that would let someone impersonate staff, the bot, or the anonymous
// label. Compared case-insensitively.
const RESERVED = new Set([
  "admin",
  "administrator",
  "miva",
  "mivacliq",
  "mivabot",
  "moderator",
  "mod",
  "system",
  "anonymous",
  "anon",
  "bot",
  "official",
  "staff",
  "support",
]);

export type NormalizedName = { username: string; lower: string };

/**
 * Validate and canonicalise a handle. Returns null if it fails any rule:
 * 3–20 chars, letters/digits/underscore only, no leading/trailing/double
 * underscore, not reserved.
 */
export function normalizeUsername(raw: unknown): NormalizedName | null {
  if (typeof raw !== "string") return null;
  const username = raw.trim();
  if (username.length < MIN_LEN || username.length > MAX_LEN) return null;
  if (!/^[A-Za-z0-9_]+$/.test(username)) return null;
  if (username.startsWith("_") || username.endsWith("_")) return null;
  if (username.includes("__")) return null;
  const lower = username.toLowerCase();
  if (RESERVED.has(lower)) return null;
  return { username, lower };
}

export async function getUsername(authorHash: string): Promise<string | null> {
  const sql = getDb();
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT username FROM users WHERE author_hash = ${authorHash}
    `) as { username: string }[];
    return rows[0]?.username ?? null;
  } catch {
    return null;
  }
}

export type SetUsernameResult =
  | { ok: true; username: string }
  | { ok: false; error: "taken" | "invalid" | "unavailable" };

/**
 * Claim or change a handle. Uniqueness is enforced by the username_lower unique
 * index — we let the DB be the arbiter and translate the unique violation into
 * "taken" so two concurrent claims can't both win.
 */
export async function setUsername(
  authorHash: string,
  raw: unknown,
): Promise<SetUsernameResult> {
  const norm = normalizeUsername(raw);
  if (!norm) return { ok: false, error: "invalid" };
  const sql = getDb();
  if (!sql) return { ok: false, error: "unavailable" };
  try {
    await sql`
      INSERT INTO users (author_hash, username, username_lower)
      VALUES (${authorHash}, ${norm.username}, ${norm.lower})
      ON CONFLICT (author_hash)
      DO UPDATE SET username = ${norm.username},
                    username_lower = ${norm.lower},
                    updated_at = now()
    `;
    return { ok: true, username: norm.username };
  } catch (e: any) {
    // 23505 = unique_violation on username_lower (handle already taken by
    // someone else). Any other error is a real failure.
    if (e?.code === "23505" || /unique/i.test(String(e?.message))) {
      return { ok: false, error: "taken" };
    }
    return { ok: false, error: "unavailable" };
  }
}

/** Delete a user's handle (they keep posting anonymously). */
export async function deleteUsername(authorHash: string): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  try {
    const rows = (await sql`
      DELETE FROM users WHERE author_hash = ${authorHash} RETURNING author_hash
    `) as { author_hash: string }[];
    return rows.length > 0;
  } catch {
    return false;
  }
}
