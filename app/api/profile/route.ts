/**
 * The student's profile guess: level, semester, department and the courses
 * "Your courses this semester" pre-selects.
 *
 *   GET /api/profile                       detect only
 *   GET /api/profile?department=<slug>     also record the curriculum and
 *                                          return package notes
 *
 * The department query param is the student's confirmed answer (kept in their
 * browser, lib/run/prefs.ts). Recording is an idempotent replace of their own
 * rows, so repeat calls don't inflate any count.
 */
import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { listCurrentCourses } from "@/lib/moodle/courses";
import { detectProfile, type ProfileOverride } from "@/lib/level/detect";
import { missingFromPackage, packageNote } from "@/lib/level/package";
import { recordCurriculum, readPackage } from "@/lib/store/curriculum";
import { isDepartment, departmentLabel } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Higher-priority sources slot in here. The SIS profile shape is unknown
 * (nobody could log in when this was written), so for now this is empty and
 * detection runs from enrolled course codes alone. When the SIS is understood,
 * fill this from it: any field set here overrides the course-code guess.
 */
function sisOverride(): ProfileOverride {
  return {};
}

export async function GET(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  const asked = req.nextUrl.searchParams.get("department");
  const confirmed = isDepartment(asked) ? asked : null;

  try {
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
      const atLevel = d.courses
        .filter((c) => c.level === d.level && c.code)
        .map((c) => c.code as string);
      // Only record a department someone vouched for, never a raw guess.
      if (confirmed || d.departmentSource === "override") {
        await recordCurriculum(session, key, atLevel);
      }
      const enrolledCodes = d.courses.map((c) => c.code).filter(Boolean) as string[];
      const label = departmentLabel(d.department);
      notes = missingFromPackage(await readPackage(key), enrolledCodes).map((code) =>
        packageNote(code, key.level, label),
      );
    }

    return NextResponse.json({
      level: d.level,
      semester: d.semester,
      department: d.department && isDepartment(d.department) ? d.department : null,
      departmentSource: d.departmentSource,
      departmentPrefix: d.departmentPrefix,
      courseSource: source,
      courses: d.courses,
      selectedIds: d.selectedIds,
      notes,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Could not load your courses." },
      { status: 502 },
    );
  }
}
