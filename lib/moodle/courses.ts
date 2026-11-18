/**
 * Course listing + name resolution.
 */
import { ajax } from "./client";
import type { MoodleSession } from "./auth";

export interface Course {
  id: number;
  fullname: string;
}

/** Moodle's timeline classifications. "inprogress" is this term's courses. */
export type Classification = "all" | "inprogress" | "future" | "past";

export async function listCourses(
  session: MoodleSession,
  classification: Classification = "all",
): Promise<Course[]> {
  const res = await ajax(
    session,
    "core_course_get_enrolled_courses_by_timeline_classification",
    { classification, limit: 0, offset: 0, sort: "fullname" },
  );
  if (res.error) {
    throw new Error(res.exception?.message || "Could not list courses.");
  }
  const courses = (res.data?.courses || []) as Array<{ id: number; fullname: string }>;
  return courses.map((c) => ({ id: c.id, fullname: c.fullname }));
}

/**
 * This semester's courses: the "inprogress" classification, falling back to
 * "all" when it errors or comes back empty (courses with no dates set, or an
 * LMS that classifies differently). `source` says which one answered.
 */
export async function listCurrentCourses(
  session: MoodleSession,
): Promise<{ courses: Course[]; source: "inprogress" | "all" }> {
  try {
    const current = await listCourses(session, "inprogress");
    if (current.length) return { courses: current, source: "inprogress" };
  } catch {
    /* fall through to "all" */
  }
  return { courses: await listCourses(session, "all"), source: "all" };
}

/** Normalise a course title for fuzzy matching (drop spaces/punctuation, lowercase). */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Pull a course code like "COS 202" / "MTH202" out of a title. */
export function codeOf(s: string): string | null {
  const m = s.match(/([a-z]{2,5})\s*[-]?\s*(\d{3})/i);
  return m ? `${m[1]}${m[2]}`.toLowerCase() : null;
}

/**
 * Resolve requested course names to enrolled Course objects.
 * Strategy: exact code match first, then normalised-substring, then fuzzy contains.
 * Returns matched courses + the names that could not be resolved.
 */
export function resolveCourses(
  requested: string[],
  enrolled: Course[],
): { matched: Course[]; unmatched: string[] } {
  const matched: Course[] = [];
  const unmatched: string[] = [];
  const used = new Set<number>();

  for (const req of requested) {
    const reqCode = codeOf(req);
    const reqNorm = norm(req);

    let hit =
      (reqCode &&
        enrolled.find((c) => !used.has(c.id) && codeOf(c.fullname) === reqCode)) ||
      enrolled.find(
        (c) =>
          !used.has(c.id) &&
          (norm(c.fullname).includes(reqNorm) || reqNorm.includes(norm(c.fullname))),
      );

    if (hit) {
      matched.push(hit);
      used.add(hit.id);
    } else {
      unmatched.push(req);
    }
  }
  return { matched, unmatched };
}
