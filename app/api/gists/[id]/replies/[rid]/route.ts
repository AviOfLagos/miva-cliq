import { NextRequest, NextResponse } from "next/server";
import { getAuthorHash } from "@/lib/identity";
import { updateReply, deleteReply, normalizeBody, MAX_BODY } from "@/lib/store/gists";
import { getUsername } from "@/lib/store/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The gist id in the path isn't needed — reply ids are globally unique and the
// author check is on the reply row itself.
type Ctx = { params: { id: string; rid: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const author = await getAuthorHash(req);
  if (!author) {
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

  const hash = author;
  // A reply's author always has a handle (required to reply); fall back defensively.
  const username = (await getUsername(hash)) ?? "Anonymous";
  const reply = await updateReply(params.rid, hash, body, username);
  if (!reply) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ reply });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const author = await getAuthorHash(req);
  if (!author) {
    return NextResponse.json({ error: "Log in to delete." }, { status: 401 });
  }
  const ok = await deleteReply(params.rid, author);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}