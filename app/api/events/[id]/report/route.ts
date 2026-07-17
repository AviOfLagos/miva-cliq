import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { reportTarget } from "@/lib/store/gists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to report." }, { status: 401 });
  }

  const result = await reportTarget("event", params.id, sessionAuthorHash(session));
  if (!result) {
    return NextResponse.json({ error: "That event is gone." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}