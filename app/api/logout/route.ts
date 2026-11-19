import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, unsealDetailed } from "@/lib/session";
import { IDENTITY_COOKIE, IDENTITY_MAX_AGE_SECONDS, unsealIdentity } from "@/lib/identity";
import { revokeSessions, type Revocation } from "@/lib/store/revocations";
import { endMoodleSession } from "@/lib/moodle/logout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Logout revokes, not just clears (#6).
 *
 *  1. The ids of both sealed cookies go on the revocation list, so a copy of
 *     either blob taken before logout stops working.
 *  2. The Moodle session itself is ended at the LMS (best effort), which also
 *     covers blobs sealed before session ids existed.
 *  3. Both cookies are cleared in the browser. Always, whatever 1 and 2 did.
 *
 * If the database is down or the table is missing, step 1 silently does
 * nothing and the cookies are still cleared; see FAILURE POLICY in
 * lib/revocation.ts for why reads fail open.
 *
 * Unsealing here deliberately skips the revocation check: revoking an already
 * revoked id is harmless (the insert is idempotent).
 */
export async function POST(req: NextRequest) {
  const moodle = unsealDetailed(req.cookies.get(SESSION_COOKIE)?.value);
  const identity = unsealIdentity(req.cookies.get(IDENTITY_COOKIE)?.value);

  const revoke: Revocation[] = [];
  if (moodle?.sid) {
    revoke.push({ sid: moodle.sid, expiresAt: moodle.iat + SESSION_MAX_AGE_SECONDS * 1000 });
  }
  if (identity) {
    revoke.push({ sid: identity.sid, expiresAt: identity.iat + IDENTITY_MAX_AGE_SECONDS * 1000 });
  }

  await Promise.all([
    revokeSessions(revoke),
    moodle ? endMoodleSession(moodle.session) : Promise.resolve(),
  ]);

  const res = NextResponse.json({ ok: true });
  for (const name of [SESSION_COOKIE, IDENTITY_COOKIE]) {
    res.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}
