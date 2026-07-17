import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { rateLimit, clientIp } from "@/lib/store/rateLimit";
import { storeEnabled } from "@/lib/store/redis";
import { addReply, listReplies, normalizeBody, MAX_BODY } from "@/lib/store/gists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPLIES_PER_HOUR = 15;
const REPLIES_PER_HOUR_PER_IP = 25;
const HOUR = 3600;

type Ctx = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const replies = await listReplies(params.id);
  return NextResponse.json({ replies });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to reply." }, { status: 401 });
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
    rateLimit(`rate:reply:${hash}`, REPLIES_PER_HOUR, HOUR),
    rateLimit(`rate:replyip:${clientIp(req)}`, REPLIES_PER_HOUR_PER_IP, HOUR),
  ]);
  if (!byUser.ok || !byIp.ok) {
    return NextResponse.json(
      { error: "You're replying too fast. Try again in a bit." },
      { status: 429 },
    );
  }

  const reply = await addReply(params.id, clean, Date.now());
  if (!reply) {
    return NextResponse.json({ error: "That gist is gone." }, { status: 404 });
  }
  return NextResponse.json({ reply }, { status: 201 });
}