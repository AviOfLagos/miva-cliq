import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { updateReply, deleteReply, normalizeBody, MAX_BODY } from "@/lib/store/gists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The gist id in the path isn't needed — reply ids are globally unique and the
// author check is on the reply row itself.
type Ctx = { params: { id: string; rid: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to edit." }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const body = normalizeBody(payload?.body);
  if (!body) {
    return NextResponse.json(
      { error: `Write something first (max ${MAX_BODY} characters).` },
      { status: 400 },
    );
  }

  const reply = await updateReply(params.rid, sessionAuthorHash(session), body);
  if (!reply) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ reply });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to delete." }, { status: 401 });
  }
  const ok = await deleteReply(params.rid, sessionAuthorHash(session));
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}