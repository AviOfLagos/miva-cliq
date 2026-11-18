/**
 * The student's profile guess: level, semester, department and the courses
 * "Your courses this semester" pre-selects.
 *
 *   GET  /api/profile[?department=<slug>]   read-only: detection, plus package
 *                                           notes for that department
 *   POST /api/profile  {"department":"<slug>"}
 *                                           confirm the department: record the
 *                                           curriculum, then answer as GET
 *
 * GET never writes: the session cookie is SameSite=Lax, so a cross-site link
 * would otherwise let anyone record a department for a logged-in student. POST
 * is refused unless the request comes from our own origin.
 */
import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import type { MoodleSession } from "@/lib/moodle/auth";
import { listCurrentCourses } from "@/lib/moodle/courses";
import { detectProfile, type ProfileOverride } from "@/lib/level/detect";
import { missingFromPackage, packageNote } from "@/lib/level/package";
import { recordCurriculum, readPackage } from "@/lib/store/curriculum";
import { isDepartment, departmentLabel } from "@/lib/taxonomy";
import { isSameOrigin } from "@/lib/http/sameOrigin";

export const runtime = "nodejs";
export const maxDuration = 30;

const LOAD_ERROR = "Could not load your courses.";

/**
 * Higher-priority sources slot in here. The SIS profile shape is unknown
 * (nobody could log in when this was written), so for now this is empty and
 * detection runs from enrolled course codes alone. When the SIS is understood,
 * fill this from it: any field set here overrides the course-code guess.
 */
function sisOverride(): ProfileOverride {
  return {};
}

async function profile(
  session: MoodleSession,
  confirmed: string | null,
  record: boolean,
) {
  const { courses, source } = await listCurrentCourses(session);
  const sis = sisOverride();
  // A confirmed answer outranks the prefix guess, but not the SIS.
  const d = detectProfile(courses, {
    ...sis,
    department: sis.department || confirmed,
  });

  let notes: string[] = [];
  if (d.department && isDepartment(d.department) && d.level && d.semester) {
    const key = { department: d.department, level: d.level, semester: d.semester };
    // Only record on an explicit confirm (POST), never on a read.
    if (record) {
      const atLevel = d.courses
        .filter((c) => c.level === d.level && c.code)
        .map((c) => c.code as string);
      await recordCurriculum(session, key, atLevel);
    }
    const enrolledCodes = d.courses.map((c) => c.code).filter(Boolean) as string[];
    const label = departmentLabel(d.department);
    notes = missingFromPackage(await readPackage(key), enrolledCodes).map((code) =>
      packageNote(code, key.level, label),
    );
  }

  return {
    level: d.level,
    semester: d.semester,
    department: d.department && isDepartment(d.department) ? d.department : null,
    departmentSource: d.departmentSource,
    departmentPrefix: d.departmentPrefix,
    courseSource: source,
    courses: d.courses,
    selectedIds: d.selectedIds,
    notes,
  };
}

export async function GET(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  const asked = req.nextUrl.searchParams.get("department");
  try {
    return NextResponse.json(await profile(session, isDepartment(asked) ? asked : null, false));
  } catch (e) {
    console.error("[profile] GET failed", e);
    return NextResponse.json({ error: LOAD_ERROR }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const ok = isSameOrigin({
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    host: req.headers.get("x-forwarded-host") || req.headers.get("host"),
  });
  if (!ok) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  let body: { department?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isDepartment(body.department)) {
    return NextResponse.json({ error: "Unknown department." }, { status: 400 });
  }
  try {
    return NextResponse.json(await profile(session, body.department, true));
  } catch (e) {
    console.error("[profile] POST failed", e);
    return NextResponse.json({ error: LOAD_ERROR }, { status: 502 });
  }
}
