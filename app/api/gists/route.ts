import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { rateLimit, clientIp } from "@/lib/store/rateLimit";
import { storeEnabled } from "@/lib/store/redis";
import { createGist, listGists, normalizeBody, MAX_BODY } from "@/lib/store/gists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSTS_PER_HOUR = 5;
const POSTS_PER_HOUR_PER_IP = 8;
const HOUR = 3600;

/** Public feed. No auth — anyone can read Gists. */
export async function GET(req: NextRequest) {
  const beforeRaw = req.nextUrl.searchParams.get("before");
  const before = beforeRaw ? Number(beforeRaw) : undefined;
  const gists = await listGists(
    Number.isFinite(before) && before! > 0 ? before : undefined,
  );
  return NextResponse.json({
    gists,
    enabled: storeEnabled(),
    nextBefore: gists.length ? gists[gists.length - 1].createdAt : null,
  });
}

/** Posting is login-gated: anonymous to readers, not anonymous to the rate limiter. */
export async function POST(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: "Log in to post a gist." },
      { status: 401 },
    );
  }
  if (!storeEnabled()) {
    return NextResponse.json(
      { error: "Gists aren't available right now." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = (await req.json())?.body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const clean = normalizeBody(body);
  if (!clean) {
    return NextResponse.json(
      { error: `Write something first (max ${MAX_BODY} characters).` },
      { status: 400 },
    );
  }

  const hash = sessionAuthorHash(session);
  const [byUser, byIp] = await Promise.all([
    rateLimit(`rate:post:${hash}`, POSTS_PER_HOUR, HOUR),
    rateLimit(`rate:ip:${clientIp(req)}`, POSTS_PER_HOUR_PER_IP, HOUR),
  ]);
  if (!byUser.ok || !byIp.ok) {
    return NextResponse.json(
      { error: "You're posting too fast. Try again in a bit." },
      { status: 429 },
    );
  }

  const gist = await createGist(clean, hash, Date.now());
  if (!gist) {
    return NextResponse.json({ error: "Couldn't post that." }, { status: 503 });
  }
  return NextResponse.json({ gist }, { status: 201 });
}