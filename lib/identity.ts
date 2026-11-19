/**
 * The 30-day identity session: "this is the same student as before", and
 * nothing more.
 *
 * Study features only need to know WHO is asking — the salted author hash from
 * lib/store/authorHash.ts — not the student's Moodle cookies. So on login we
 * set a second cookie that seals exactly three things: that hash, a random
 * session id (for revocation, lib/revocation.ts) and the issue time. No Moodle
 * cookies, no sesskey, no email, no name. A copy of this cookie lets someone
 * post a Gist as that anonymous student until it expires or is revoked; it
 * does not let them touch the student's LMS account. The Moodle session keeps
 * its own two-hour lifetime (lib/session.ts) and is the only thing that can.
 *
 * Routes call:
 *   getStudent(req) / getAuthorHash(req) — who is this? Identity cookie first,
 *     then the Moodle session, so routes work for students who logged in
 *     before the identity cookie existed.
 *   getLmsSession(req) — the Moodle session, for anything that talks to Miva.
 * Both honour the revocation list.
 */
import type { MoodleSession } from "./moodle/auth";
import { deriveKey, newSessionId, openJson, sealJson, withinAge } from "./seal.ts";
import { SESSION_COOKIE, unsealDetailed } from "./session.ts";
import { passesRevocation, type RevocationLookup } from "./revocation.ts";
import { sessionAuthorHash } from "./store/authorHash.ts";
import { revocationLookup } from "./store/revocations.ts";

export const IDENTITY_COOKIE = "mc_id";
export const IDENTITY_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** The whole sealed payload. Adding a field here widens what a stolen cookie reveals. */
export type Identity = { a: string; sid: string; iat: number };

const key = () => deriveKey("identity-v1");

export function sealIdentity(authorHash: string, now = Date.now()): { blob: string; identity: Identity } {
  if (!authorHash) throw new Error("authorHash required");
  // Built field by field rather than spread from anything, so no caller can
  // widen the payload by accident.
  const identity: Identity = { a: authorHash, sid: newSessionId(), iat: now };
  return { blob: sealJson(identity, key()), identity };
}

/** Null for tampered, malformed, expired or future-dated blobs. */
export function unsealIdentity(blob: string | undefined | null, now = Date.now()): Identity | null {
  const p = openJson(blob, key()) as Partial<Identity> | null;
  if (!p || typeof p !== "object") return null;
  if (typeof p.a !== "string" || !p.a || p.a.length > 64) return null;
  if (typeof p.sid !== "string" || !p.sid) return null;
  if (!withinAge(p.iat, IDENTITY_MAX_AGE_SECONDS, now)) return null;
  return { a: p.a, sid: p.sid, iat: p.iat as number };
}

export type Student = {
  authorHash: string;
  /** Which cookie proved it. "session" means the Moodle session is valid too. */
  via: "identity" | "session";
};

export type ResolveDeps = {
  lookup: RevocationLookup | null;
  hashSession: (s: MoodleSession) => string;
  now?: number;
};

/**
 * The fallback order, separated from the request so it can be tested:
 *   1. a valid, unrevoked identity cookie;
 *   2. else a valid, unrevoked Moodle session, hashed the same way login
 *      hashed it for the identity cookie;
 *   3. else nobody.
 */
export async function resolveStudent(
  cookies: { identity?: string | null; session?: string | null },
  deps: ResolveDeps,
): Promise<Student | null> {
  const id = unsealIdentity(cookies.identity, deps.now);
  if (id && (await passesRevocation(id.sid, deps.lookup))) {
    return { authorHash: id.a, via: "identity" };
  }
  const opened = unsealDetailed(cookies.session, deps.now);
  if (opened && (await passesRevocation(opened.sid, deps.lookup))) {
    try {
      return { authorHash: deps.hashSession(opened.session), via: "session" };
    } catch {
      return null; // no salt configured
    }
  }
  return null;
}

/** The subset of NextRequest these helpers read. */
type CookieReq = { cookies: { get(name: string): { value: string } | undefined } };

export function getStudent(req: CookieReq): Promise<Student | null> {
  return resolveStudent(
    {
      identity: req.cookies.get(IDENTITY_COOKIE)?.value,
      session: req.cookies.get(SESSION_COOKIE)?.value,
    },
    { lookup: revocationLookup(), hashSession: sessionAuthorHash },
  );
}

/** The student's anonymous author hash, or null when nobody is signed in. */
export async function getAuthorHash(req: CookieReq): Promise<string | null> {
  return (await getStudent(req))?.authorHash ?? null;
}

/** The Moodle session, if valid and not revoked. Needed for anything that calls Miva. */
export async function getLmsSession(req: CookieReq): Promise<MoodleSession | null> {
  const opened = unsealDetailed(req.cookies.get(SESSION_COOKIE)?.value);
  if (!opened) return null;
  return (await passesRevocation(opened.sid, revocationLookup())) ? opened.session : null;
}
