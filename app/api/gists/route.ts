import { NextRequest, NextResponse } from "next/server";
import { getAuthorHash } from "@/lib/identity";
import { rateLimit, recordRateEvent, clientIp } from "@/lib/store/rateLimit";
import { storeEnabled } from "@/lib/store/db";
import { createGist, listGists, normalizeBody, MAX_BODY } from "@/lib/store/gists";
import { getUsername } from "@/lib/store/users";
import { isCategory, isDepartment, DEFAULT_CATEGORY } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSTS_PER_HOUR = 5;
const POSTS_PER_HOUR_PER_IP = 8;
const HOUR = 3600;

/** Public feed. No auth — anyone can read Gists. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  // Unknown slugs are ignored rather than 400'd — a stale bookmark should show
  // the unfiltered feed, not an error.
  const category = isCategory(q.get("category")) ? q.get("category") : null;
  const department = isDepartment(q.get("department")) ? q.get("department") : null;
  const beforeRaw = Number(q.get("before"));
  const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : null;

  const gists = await listGists({ category, department, before });
  return NextResponse.json({
    gists,
    enabled: storeEnabled(),
    nextBefore: gists.length ? gists[gists.length - 1].createdAt : null,
  });
}

/** Posting is login-gated: anonymous to readers, not anonymous to the rate limiter. */
export async function POST(req: NextRequest) {
  const author = await getAuthorHash(req);
  if (!author) {
    return NextResponse.json({ error: "Log in to post a gist." }, { status: 401 });
  }
  if (!storeEnabled()) {
    return NextResponse.json(
      { error: "Gists aren't available right now." },
      { status: 503 },
    );
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
  // Department is optional by design — see the anonymity note in db/schema.sql.
  const department = isDepartment(payload?.department) ? payload.department : null;

  const hash = author;

  // Posting under your name needs a handle. Anonymous posts don't.
  const showAuthor = payload?.showAuthor === true;
  const username = showAuthor ? await getUsername(hash) : null;
  if (showAuthor && !username) {
    return NextResponse.json(
      { error: "username_required" },
      { status: 409 },
    );
  }

  const ip = clientIp(req);
  const [byUser, byIp] = await Promise.all([
    rateLimit(hash, "gist", POSTS_PER_HOUR, HOUR),
    rateLimit(`ip:${ip}`, "gist", POSTS_PER_HOUR_PER_IP, HOUR),
  ]);
  if (!byUser.ok || !byIp.ok) {
    return NextResponse.json(
      { error: "You're posting too fast. Try again in a bit." },
      { status: 429 },
    );
  }

  const gist = await createGist({
    body,
    category,
    department,
    authorHash: hash,
    showAuthor,
    authorName: username,
  });
  if (!gist) {
    return NextResponse.json({ error: "Couldn't post that." }, { status: 503 });
  }
  await Promise.all([
    recordRateEvent(hash, "gist"),
    recordRateEvent(`ip:${ip}`, "gist"),
  ]);
  return NextResponse.json({ gist }, { status: 201 });
}