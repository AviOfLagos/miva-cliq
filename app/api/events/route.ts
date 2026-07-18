import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { rateLimit, recordRateEvent, clientIp } from "@/lib/store/rateLimit";
import { storeEnabled } from "@/lib/store/db";
import { normalizeBody } from "@/lib/store/gists";
import {
  createEvent,
  listEvents,
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

// Tighter than gists: a fake event wastes people's time in a way a bad post doesn't.
const EVENTS_PER_DAY = 3;
const EVENTS_PER_DAY_PER_IP = 5;
const DAY = 86400;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const department = isDepartment(q.get("department")) ? q.get("department") : null;
  const past = q.get("past") === "1";
  const events = await listEvents({ department, past });
  return NextResponse.json({ events, enabled: storeEnabled() });
}

export async function POST(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to post an event." }, { status: 401 });
  }
  if (!storeEnabled()) {
    return NextResponse.json(
      { error: "Events aren't available right now." },
      { status: 503 },
    );
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

  // normalizeLink separates "no link" (null) from "bad link" (undefined) so a
  // javascript: URL is rejected rather than silently dropped.
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
  const username = showAuthor ? await getUsername(hash) : null;
  if (showAuthor && !username) {
    return NextResponse.json({ error: "username_required" }, { status: 409 });
  }

  const ip = clientIp(req);
  const [byUser, byIp] = await Promise.all([
    rateLimit(hash, "event", EVENTS_PER_DAY, DAY),
    rateLimit(`ip:${ip}`, "event", EVENTS_PER_DAY_PER_IP, DAY),
  ]);
  if (!byUser.ok || !byIp.ok) {
    return NextResponse.json(
      { error: "You've posted enough events for today." },
      { status: 429 },
    );
  }

  const event = await createEvent({
    title,
    body: body || "",
    startsAt,
    location,
    link,
    department,
    authorHash: hash,
    showAuthor,
    authorName: username,
  });
  if (!event) {
    return NextResponse.json({ error: "Couldn't post that." }, { status: 503 });
  }
  await Promise.all([
    recordRateEvent(hash, "event"),
    recordRateEvent(`ip:${ip}`, "event"),
  ]);
  return NextResponse.json({ event }, { status: 201 });
}