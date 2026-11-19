/**
 * GET /api/practice/courses            every course with a saved outline
 * GET /api/practice/courses?code=cos202 that course's weeks with coverage
 *
 * "Browse all courses": anyone signed in can practise any prepared week of any
 * course, enrolled or not, so a student from any department can start once
 * someone has prepared their courses. Course-level data only (codes, titles,
 * week titles, counts); nothing about who opened or prepared what.
 *
 * 200 { courses: [{ courseCode, courseTitle, weeks, ready, started }], target }
 * 200 { courseCode, courseTitle, weeks: [{ week, weekTitle, count, hasNotes }], target }
 * 503 { unavailable: true } when the practice tables are not there yet
 */
import { NextRequest, NextResponse } from "next/server";
import { BANK_TARGET, cleanCourseCode } from "@/lib/practice/core";
import { browseCourses, notesWeeks, outlineWeeks, PracticeUnavailable, weekCounts } from "@/lib/store/practice";
import { badRequest, notLoggedIn, studentKey, tryAgain, unavailable } from "@/lib/practice/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const student = await studentKey(req);
  if (!student) return notLoggedIn();
  const raw = req.nextUrl.searchParams.get("code");

  try {
    if (raw === null) {
      const courses = await browseCourses(BANK_TARGET);
      return NextResponse.json({ courses, target: BANK_TARGET });
    }
    const courseCode = cleanCourseCode(raw.toLowerCase());
    if (!courseCode) return badRequest("Pick a course first.");
    const [outline, counts, noted] = await Promise.all([
      outlineWeeks(courseCode),
      weekCounts(courseCode),
      notesWeeks(courseCode),
    ]);
    if (!outline.weeks.length) {
      return NextResponse.json({ error: "Nobody has opened that course on Study yet." }, { status: 404 });
    }
    return NextResponse.json({
      courseCode,
      courseTitle: outline.courseTitle,
      weeks: outline.weeks.map((w) => ({
        week: w.week,
        weekTitle: w.weekTitle,
        count: counts ? (counts.get(w.week) ?? 0) : null,
        hasNotes: noted ? noted.has(w.week) : null,
      })),
      target: BANK_TARGET,
    });
  } catch (e) {
    if (e instanceof PracticeUnavailable) return unavailable();
    console.error("[practice/courses] failed", (e as any)?.code ?? (e as any)?.name);
    return tryAgain();
  }
}
