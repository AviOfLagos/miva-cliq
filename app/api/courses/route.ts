import { NextRequest, NextResponse } from "next/server";
import { listCourses } from "@/lib/moodle/courses";
import { unseal, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  try {
    const courses = await listCourses(session);
    return NextResponse.json({ courses });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Could not load courses." },
      { status: 502 },
    );
  }
}
