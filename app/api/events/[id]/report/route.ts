import { NextRequest, NextResponse } from "next/server";
import { getAuthorHash } from "@/lib/identity";
import { reportTarget } from "@/lib/store/gists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  const author = await getAuthorHash(req);
  if (!author) {
    return NextResponse.json({ error: "Log in to report." }, { status: 401 });
  }

  const result = await reportTarget("event", params.id, author);
  if (!result) {
    return NextResponse.json({ error: "That event is gone." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}