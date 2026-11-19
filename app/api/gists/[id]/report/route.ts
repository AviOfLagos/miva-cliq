import { NextRequest, NextResponse } from "next/server";
import { getAuthorHash } from "@/lib/identity";
import { reportTarget } from "@/lib/store/gists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * Community moderation. Enough reports and the post leaves the feed — that's the
 * cleanup lever, so there's no admin queue to babysit. One report per person is
 * enforced by the reports primary key, so nobody can bury a post they dislike.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const author = await getAuthorHash(req);
  if (!author) {
    return NextResponse.json({ error: "Log in to report." }, { status: 401 });
  }

  const result = await reportTarget("gist", params.id, author);
  if (!result) {
    return NextResponse.json({ error: "That gist is gone." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}