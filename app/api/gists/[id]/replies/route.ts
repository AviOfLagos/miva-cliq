import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { rateLimit, recordRateEvent, clientIp } from "@/lib/store/rateLimit";
import { storeEnabled } from "@/lib/store/db";
import {
  addReply,
  listReplies,
  ownedReplyIds,
  normalizeBody,
  MAX_BODY,
} from "@/lib/store/gists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPLIES_PER_HOUR = 15;
const REPLIES_PER_HOUR_PER_IP = 25;
const HOUR = 3600;

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const replies = await listReplies(params.id);
  // Mark which replies belong to the viewer so the UI can show edit controls.
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  const mine = session
    ? await ownedReplyIds(params.id, sessionAuthorHash(session))
    : [];
  return NextResponse.json({ replies, mine });
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

  const hash = sessionAuthorHash(session);
  const ip = clientIp(req);
  const [byUser, byIp] = await Promise.all([
    rateLimit(hash, "reply", REPLIES_PER_HOUR, HOUR),
    rateLimit(`ip:${ip}`, "reply", REPLIES_PER_HOUR_PER_IP, HOUR),
  ]);
  if (!byUser.ok || !byIp.ok) {
    return NextResponse.json(
      { error: "You're replying too fast. Try again in a bit." },
      { status: 429 },
    );
  }

  const reply = await addReply(params.id, body, hash);
  if (!reply) {
    return NextResponse.json({ error: "That gist is gone." }, { status: 404 });
  }
  await Promise.all([
    recordRateEvent(hash, "reply"),
    recordRateEvent(`ip:${ip}`, "reply"),
  ]);
  return NextResponse.json({ reply }, { status: 201 });
}