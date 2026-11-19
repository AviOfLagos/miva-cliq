import { NextRequest, NextResponse } from "next/server";
import { getStudent, getLmsSession } from "@/lib/identity";
import { getUsername } from "@/lib/store/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who the viewer is, as two facts the client can act on:
 *   signedIn     — a valid identity (30-day cookie, or the Moodle session).
 *                  Enough for study pages, Gists, Events, the answer bank.
 *   lmsConnected — a valid Moodle session (two hours). Needed for Autopilot,
 *                  the course list and the study pack.
 * Plus the community handle (null = hasn't picked one). Nothing else: no name,
 * no email, no ids.
 */
export async function GET(req: NextRequest) {
  const student = await getStudent(req);
  if (!student) {
    return NextResponse.json(
      { error: "Not logged in.", signedIn: false, lmsConnected: false },
      { status: 401 },
    );
  }
  const lmsConnected = student.via === "session" || (await getLmsSession(req)) !== null;
  const username = await getUsername(student.authorHash);
  return NextResponse.json({ signedIn: true, lmsConnected, username });
}
