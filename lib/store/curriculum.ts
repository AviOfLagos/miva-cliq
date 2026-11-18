/**
 * The self-building curriculum (see the `curriculum` table in db/schema.sql).
 *
 * Every function degrades quietly when the database is off or the salt is
 * missing: the profile still works, it just has no package to compare against.
 */
import { getDb } from "./db";
import { sessionAuthorHash } from "./authorHash";
import type { MoodleSession } from "@/lib/moodle/auth";
import type { Semester } from "@/lib/level/detect";
import { majorityPackage, type CodeCount } from "@/lib/level/package";

export interface CurriculumKey {
  department: string;
  level: number;
  semester: Semester;
}

/**
 * Replace this student's codes for a level + semester with the current set.
 * Delete-then-insert in one transaction: a corrected department or a dropped
 * course must not keep counting. Only the salted hash identifies the student.
 */
export async function recordCurriculum(
  session: MoodleSession,
  key: CurriculumKey,
  codes: string[],
): Promise<void> {
  const sql = getDb();
  const unique = Array.from(new Set(codes)).slice(0, 30);
  if (!sql || unique.length === 0) return;
  try {
    const who = sessionAuthorHash(session);
    await sql.transaction([
      sql`
        DELETE FROM curriculum
        WHERE author_hash = ${who} AND level = ${key.level} AND semester = ${key.semester}
      `,
      sql`
        INSERT INTO curriculum (department, level, semester, course_code, author_hash)
        SELECT ${key.department}, ${key.level}, ${key.semester}, code, ${who}
        FROM unnest(${unique}::text[]) AS code
        ON CONFLICT DO NOTHING
      `,
    ]);
  } catch {
    /* recording must never break the profile */
  }
}

/** The codes a clear majority of distinct students in this cohort share. */
export async function readPackage(key: CurriculumKey): Promise<string[]> {
  const sql = getDb();
  if (!sql) return [];
  try {
    const [counts, cohort] = await Promise.all([
      sql`
        SELECT course_code AS code, count(DISTINCT author_hash)::int AS students
        FROM curriculum
        WHERE department = ${key.department} AND level = ${key.level}
          AND semester = ${key.semester}
        GROUP BY course_code
      `,
      sql`
        SELECT count(DISTINCT author_hash)::int AS n
        FROM curriculum
        WHERE department = ${key.department} AND level = ${key.level}
          AND semester = ${key.semester}
      `,
    ]);
    const n = Number((cohort[0] as { n?: number })?.n) || 0;
    return majorityPackage(counts as CodeCount[], n);
  } catch {
    return [];
  }
}
