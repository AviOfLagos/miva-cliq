import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { listCourses, resolveCourses, type Course } from "@/lib/moodle/courses";
import { plan } from "@/lib/completion/engine";
import { getPreset } from "@/lib/presets";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: { presetId?: string; courseIds?: number[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const enrolled = await listCourses(session);
    let target: Course[] = [];
    let unmatched: string[] = [];

    if (body.presetId) {
      const preset = getPreset(body.presetId);
      if (!preset)
        return NextResponse.json({ error: "Unknown preset." }, { status: 400 });
      const r = resolveCourses(preset.courses, enrolled);
      target = r.matched;
      unmatched = r.unmatched;
    } else if (body.courseIds?.length) {
      const set = new Set(body.courseIds.map(Number));
      target = enrolled.filter((c) => set.has(c.id));
    } else {
      return NextResponse.json(
        { error: "Provide presetId or courseIds." },
        { status: 400 },
      );
    }

    const courses = [];
    for (const c of target) {
      const activities = await plan(session, c.id);
      courses.push({ id: c.id, fullname: c.fullname, activities });
    }

    return NextResponse.json({ courses, unmatched });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Could not build plan." },
      { status: 502 },
    );
  }
}
