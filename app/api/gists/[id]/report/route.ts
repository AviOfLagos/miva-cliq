import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { rateLimit } from "@/lib/store/rateLimit";
import { reportGist } from "@/lib/store/gists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * Community moderation. Enough reports and the post leaves the feed — that's
 * the cleanup lever, so there's no admin queue to babysit. Login-gated and
 * rate-limited so one person can't bury a post they dislike.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to report." }, { status: 401 });
  }

  const hash = sessionAuthorHash(session);
  // One report per person per gist.
  const once = await rateLimit(`rate:report:${hash}:${params.id}`, 1, 86400);
  if (!once.ok) {
    return NextResponse.json({ ok: true, alreadyReported: true });
  }

  const result = await reportGist(params.id);
  if (!result) {
    return NextResponse.json({ error: "That gist is gone." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, hidden: result.hidden });
}