import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { storeEnabled } from "@/lib/store/db";
import { normalizeBody } from "@/lib/store/gists";
import {
  getEvent,
  ownsEvent,
  updateEvent,
  deleteEvent,
  normalizeLink,
  normalizeStartsAt,
  MAX_TITLE,
  MAX_BODY,
  MAX_LOCATION,
} from "@/lib/store/events";
import { getUsername } from "@/lib/store/users";
import { isDepartment } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const event = await getEvent(params.id);
  if (!event) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  const mine = session ? await ownsEvent(params.id, sessionAuthorHash(session)) : false;
  return NextResponse.json({ event, mine });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
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

  const title = normalizeBody(payload?.title, MAX_TITLE);
  if (!title) {
    return NextResponse.json(
      { error: `Give it a title (max ${MAX_TITLE} characters).` },
      { status: 400 },
    );
  }
  const startsAt = normalizeStartsAt(payload?.startsAt, Date.now());
  if (!startsAt) {
    return NextResponse.json(
      { error: "Pick a date and time in the future (within the next year)." },
      { status: 400 },
    );
  }
  const link = normalizeLink(payload?.link);
  if (link === undefined) {
    return NextResponse.json(
      { error: "That link doesn't look like a valid http(s) URL." },
      { status: 400 },
    );
  }
  const body = payload?.body ? normalizeBody(payload.body, MAX_BODY) : "";
  if (body === null) {
    return NextResponse.json(
      { error: `Description is too long (max ${MAX_BODY} characters).` },
      { status: 400 },
    );
  }
  const location = payload?.location
    ? normalizeBody(payload.location, MAX_LOCATION)
    : null;
  if (location === null && payload?.location) {
    return NextResponse.json(
      { error: `Location is too long (max ${MAX_LOCATION} characters).` },
      { status: 400 },
    );
  }
  const department = isDepartment(payload?.department) ? payload.department : null;

  const hash = sessionAuthorHash(session);
  const showAuthor = payload?.showAuthor === true;
  if (showAuthor && !(await getUsername(hash))) {
    return NextResponse.json({ error: "username_required" }, { status: 409 });
  }

  const event = await updateEvent(params.id, hash, {
    title,
    body: body || "",
    startsAt,
    location,
    link,
    department,
    showAuthor,
  });
  if (!event) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ event });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to delete." }, { status: 401 });
  }
  const ok = await deleteEvent(params.id, sessionAuthorHash(session));
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}