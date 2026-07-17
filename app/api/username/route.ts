import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { setUsername, deleteUsername, MIN_LEN, MAX_LEN } from "@/lib/store/users";
import { rateLimit, recordRateEvent } from "@/lib/store/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RENAMES_PER_DAY = 5;
const DAY = 86400;

export async function PUT(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to set a username." }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const hash = sessionAuthorHash(session);

  // Cap renames so a handle can't be churned to squat names or evade blocks.
  const gate = await rateLimit(hash, "username", RENAMES_PER_DAY, DAY);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many username changes today. Try again tomorrow." },
      { status: 429 },
    );
  }

  const result = await setUsername(hash, payload?.username);
  if (!result.ok) {
    if (result.error === "taken") {
      return NextResponse.json(
        { error: "That username is taken." },
        { status: 409 },
      );
    }
    if (result.error === "invalid") {
      return NextResponse.json(
        {
          error: `${MIN_LEN}–${MAX_LEN} characters, letters/numbers/underscore only.`,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Usernames aren't available right now." },
      { status: 503 },
    );
  }

  await recordRateEvent(hash, "username");
  return NextResponse.json({ username: result.username });
}

export async function DELETE(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  await deleteUsername(sessionAuthorHash(session));
  return NextResponse.json({ ok: true });
}
