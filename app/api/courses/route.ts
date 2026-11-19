import { NextRequest, NextResponse } from "next/server";
import { listCourses } from "@/lib/moodle/courses";
import { getLmsSession } from "@/lib/identity";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const session = await getLmsSession(req);
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
