import { NextRequest, NextResponse } from "next/server";
import { listCourses, codeOf } from "@/lib/moodle/courses";
import { getCourseState } from "@/lib/moodle/activities";
import { listAnswers } from "@/lib/store/quizAnswers";
import { storeEnabled } from "@/lib/store/db";
import { getLmsSession } from "@/lib/identity";
import { cleanWeekTitle, topicsFromActivities, type SampleQuestion } from "@/lib/study/prompts";
import { saveOutline, weekCounts } from "@/lib/store/practice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SAMPLES_PER_WEEK = 5;

export type StudyWeekData = {
  weekNumber: number;
  weekTitle: string;
  topics: string[];
  sampleQuestions: SampleQuestion[];
  /** Usable practice questions in the bank for this week; null when practice is unavailable. */
  practiceCount: number | null;
};

/**
 * GET /api/study?courseId=N — one course's weeks, each with the topics derived
 * from its activity names and (when the shared bank has any) up to five real
 * questions. Prompts are built on the client from this data with
 * lib/study/prompts.ts. The only write is the shared course outline (course
 * code, week titles, topic names: nothing about the student), saved so practice
 * questions can be generated later without asking the LMS again.
 */
export async function GET(req: NextRequest) {
  const session = await getLmsSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  const courseId = Number(req.nextUrl.searchParams.get("courseId"));
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ error: "Pick a course first." }, { status: 400 });
  }

  try {
    const [courses, state] = await Promise.all([
      listCourses(session),
      getCourseState(session, courseId),
    ]);
    const course = courses.find((c) => c.id === courseId);
    if (!course) {
      return NextResponse.json({ error: "That course isn't on your list." }, { status: 404 });
    }
    const courseCode = codeOf(course.fullname);

    const titles = new Map(state.sections.map((s) => [s.number, s.title]));
    const bySection = new Map<number, { name: string; modname: string }[]>();
    for (const a of state.activities) {
      // Section 0 is the course's general area (announcements, guides), not a week.
      if (a.section === null || a.section <= 0) continue;
      const list = bySection.get(a.section) ?? [];
      list.push({ name: a.name, modname: a.modname });
      bySection.set(a.section, list);
    }

    const weeks = [...bySection.entries()]
      .sort(([a], [b]) => a - b)
      .map(([n, acts]) => ({
        weekNumber: n,
        weekTitle: titles.get(n) ?? "",
        topics: topicsFromActivities(acts),
      }))
      .filter((w) => w.topics.length > 0 || cleanWeekTitle(w.weekTitle));

    // Bank questions are a bonus: no DB, no code, or a failed query all mean
    // "no samples", never an error.
    const useBank = storeEnabled() && !!courseCode;
    const [counts] = await Promise.all([
      useBank && courseCode ? weekCounts(courseCode) : Promise.resolve(null),
      useBank && courseCode
        ? saveOutline(
            courseCode,
            course.fullname,
            weeks.map((w) => ({ week: w.weekNumber, weekTitle: w.weekTitle, topics: w.topics })),
          )
        : Promise.resolve(),
    ]);
    const out: StudyWeekData[] = await Promise.all(
      weeks.map(async (w) => {
        let sampleQuestions: SampleQuestion[] = [];
        if (useBank) {
          const rows = await listAnswers({ courseCode, section: w.weekNumber }).catch(() => []);
          // Only confirmed rows: the bank accepts edits from any student, and
          // this text ends up inside a prompt someone else pastes into a chatbot.
          sampleQuestions = rows
            .filter((r) => r.status === "confirmed" && r.questionText.trim())
            .slice(0, SAMPLES_PER_WEEK)
            .map((r) => ({ question: r.questionText }));
        }
        return { ...w, sampleQuestions, practiceCount: counts ? (counts.get(w.weekNumber) ?? 0) : null };
      }),
    );

    return NextResponse.json({
      course: { id: course.id, fullname: course.fullname, code: courseCode },
      weeks: out,
    });
  } catch (e) {
    console.error("[study] could not read course", courseId, e);
    return NextResponse.json(
      { error: "We couldn't read this course from Miva right now. Try again in a minute." },
      { status: 502 },
    );
  }
}
