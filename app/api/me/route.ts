import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { getUsername } from "@/lib/store/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The viewer's own community handle (null = hasn't picked one). */
export async function GET(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  const username = await getUsername(sessionAuthorHash(session));
  return NextResponse.json({ username });
}
