import { NextRequest, NextResponse } from "next/server";
import { getAuthorHash } from "@/lib/identity";
import { storeEnabled } from "@/lib/store/db";
import {
  getGist,
  ownsGist,
  updateGist,
  deleteGist,
  normalizeBody,
  MAX_BODY,
} from "@/lib/store/gists";
import { getUsername } from "@/lib/store/users";
import { isCategory, isDepartment, DEFAULT_CATEGORY } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * Single gist. `mine` tells the client whether to show edit/delete controls; it
 * only turns true for the authenticated author, and the stored hash never ships.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const gist = await getGist(params.id);
  if (!gist) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const author = await getAuthorHash(req);
  const mine = author ? await ownsGist(params.id, author) : false;
  return NextResponse.json({ gist, mine });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const author = await getAuthorHash(req);
  if (!author) {
    return NextResponse.json({ error: "Log in to edit." }, { status: 401 });
  }
  if (!storeEnabled()) {
    return NextResponse.json({ error: "Unavailable." }, { status: 503 });
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
  const category = isCategory(payload?.category) ? payload.category : DEFAULT_CATEGORY;
  const department = isDepartment(payload?.department) ? payload.department : null;

  const hash = author;
  const showAuthor = payload?.showAuthor === true;
  if (showAuthor && !(await getUsername(hash))) {
    return NextResponse.json({ error: "username_required" }, { status: 409 });
  }

  const gist = await updateGist(params.id, hash, {
    body,
    category,
    department,
    showAuthor,
  });
  // null == not found OR not the author — same 404 either way, so we never
  // confirm a post exists to someone who can't edit it.
  if (!gist) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ gist });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const author = await getAuthorHash(req);
  if (!author) {
    return NextResponse.json({ error: "Log in to delete." }, { status: 401 });
  }
  const ok = await deleteGist(params.id, author);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}