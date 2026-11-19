/**
 * Practice storage: course outlines, the question bank and attempts.
 *
 * The tables may not exist yet (db/schema.sql has to be pushed), and the DB may
 * not be configured at all. Both surface as PracticeUnavailable, which routes
 * turn into a calm "not available yet" answer. Nothing here logs a row, and
 * author_hash is written but never read back out to a caller.
 */
import { getDb } from "./db";
import {
  nextStatus,
  type Attempt,
  type PracticeStatus,
  type StoredQuestion,
  type ValidQuestion,
} from "@/lib/practice/core";
import type { Outline } from "@/lib/practice/generate";

export class PracticeUnavailable extends Error {
  constructor() {
    super("practice store unavailable");
    this.name = "PracticeUnavailable";
  }
}

/** Postgres "undefined_table" / "undefined_column": the schema hasn't been pushed. */
function isMissingSchema(e: unknown): boolean {
  const code = (e as any)?.code;
  return code === "42P01" || code === "42703";
}

function db() {
  const sql = getDb();
  if (!sql) throw new PracticeUnavailable();
  return sql;
}

/** Run a query; a missing table becomes PracticeUnavailable, anything else propagates. */
async function q<T>(fn: (sql: ReturnType<typeof db>) => Promise<unknown>): Promise<T> {
  const sql = db();
  try {
    return (await fn(sql)) as T;
  } catch (e) {
    if (isMissingSchema(e)) throw new PracticeUnavailable();
    throw e;
  }
}

/* ------------------------------------------------------------- outline --- */

export type OutlineWeek = { week: number; weekTitle: string; topics: string[] };

/**
 * Upsert a course's weeks, one round trip. Best effort: /api/study calls this
 * on every read and must never fail because of it.
 */
export async function saveOutline(courseCode: string, courseTitle: string, weeks: OutlineWeek[]): Promise<void> {
  const sql = getDb();
  if (!sql || !weeks.length) return;
  const rows = JSON.stringify(
    weeks.map((w) => ({ week: w.week, week_title: w.weekTitle.slice(0, 300), topics: w.topics.slice(0, 30) })),
  );
  try {
    await sql`
      INSERT INTO course_outline (course_code, week, course_title, week_title, topics, updated_at)
      SELECT ${courseCode}, x.week, ${courseTitle.slice(0, 300)}, x.week_title, x.topics, now()
        FROM jsonb_to_recordset(${rows}::jsonb) AS x(week int, week_title text, topics jsonb)
      ON CONFLICT (course_code, week) DO UPDATE
        SET course_title = EXCLUDED.course_title,
            week_title   = EXCLUDED.week_title,
            topics       = EXCLUDED.topics,
            updated_at   = now()
    `;
  } catch {
    /* table not there yet, or a blip: study still works */
  }
}

export async function getOutline(courseCode: string, week: number): Promise<Outline | null> {
  const rows = await q<any[]>((sql) => sql`
    SELECT course_title, week_title, topics FROM course_outline
     WHERE course_code = ${courseCode} AND week = ${week}
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    courseCode,
    courseTitle: String(r.course_title ?? ""),
    week,
    weekTitle: String(r.week_title ?? ""),
    topics: Array.isArray(r.topics) ? r.topics.filter((t: unknown) => typeof t === "string") : [],
  };
}

/** The next week of this course that has an outline, for the "Next week" button. */
export async function nextOutlineWeek(courseCode: string, week: number): Promise<number | null> {
  const rows = await q<any[]>((sql) => sql`
    SELECT min(week)::int AS w FROM course_outline WHERE course_code = ${courseCode} AND week > ${week}
  `);
  return rows[0]?.w ?? null;
}

/** Usable (not hidden) question count per week for a course. Empty map if unavailable. */
export async function weekCounts(courseCode: string): Promise<Map<number, number> | null> {
  try {
    const rows = await q<any[]>((sql) => sql`
      SELECT week, count(*)::int AS n FROM practice_questions
       WHERE course_code = ${courseCode} AND status <> 'hidden'
       GROUP BY week
    `);
    return new Map(rows.map((r) => [Number(r.week), Number(r.n)]));
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- questions --- */

function toStored(r: any): StoredQuestion {
  return {
    id: String(r.id),
    question: String(r.question),
    options: Array.isArray(r.options) ? r.options.map(String) : [],
    answerIndex: Number(r.answer_index),
    explanation: String(r.explanation ?? ""),
    status: (["unconfirmed", "confirmed", "hidden"].includes(r.status) ? r.status : "unconfirmed") as PracticeStatus,
  };
}

/** Usable questions for one course-week. Capped: a week never needs more than a few hundred. */
export async function weekBank(courseCode: string, week: number): Promise<StoredQuestion[]> {
  const rows = await q<any[]>((sql) => sql`
    SELECT id, question, options, answer_index, explanation, status
      FROM practice_questions
     WHERE course_code = ${courseCode} AND week = ${week} AND status <> 'hidden'
     ORDER BY id
     LIMIT 300
  `);
  return rows.map(toStored);
}

/** Every known question hash for a week, hidden ones included, so a hidden question is not re-added. */
export async function weekHashes(courseCode: string, week: number): Promise<string[]> {
  const rows = await q<any[]>((sql) => sql`
    SELECT question_hash FROM practice_questions WHERE course_code = ${courseCode} AND week = ${week}
  `);
  return rows.map((r) => String(r.question_hash));
}

export async function getQuestion(id: string): Promise<StoredQuestion | null> {
  const rows = await q<any[]>((sql) => sql`
    SELECT id, question, options, answer_index, explanation, status
      FROM practice_questions WHERE id = ${id}::bigint
  `);
  return rows[0] ? toStored(rows[0]) : null;
}

/** Insert a validated batch. Returns how many were new (the UNIQUE hash drops repeats). */
export async function insertQuestions(
  courseCode: string,
  week: number,
  authorHash: string,
  questions: ValidQuestion[],
): Promise<number> {
  if (!questions.length) return 0;
  const rows = JSON.stringify(
    questions.map((v) => ({
      question: v.question,
      options: v.options,
      answer_index: v.answerIndex,
      explanation: v.explanation,
      question_hash: v.hash,
    })),
  );
  const out = await q<any[]>((sql) => sql`
    INSERT INTO practice_questions
      (course_code, week, question, options, answer_index, explanation, question_hash, author_hash, source)
    SELECT ${courseCode}, ${week}, x.question, x.options, x.answer_index, x.explanation, x.question_hash, ${authorHash}, 'ai'
      FROM jsonb_to_recordset(${rows}::jsonb)
        AS x(question text, options jsonb, answer_index int, explanation text, question_hash text)
    ON CONFLICT (question_hash) DO NOTHING
    RETURNING id
  `);
  return out.length;
}

export async function markServed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await q((sql) => sql`
      UPDATE practice_questions SET served_count = served_count + 1 WHERE id = ANY(${ids}::bigint[])
    `);
  } catch {
    /* a counter is not worth failing a set over */
  }
}

/* ----------------------------------------------------------- attempts --- */

export async function attemptsFor(authorHash: string, questionIds: string[]): Promise<Attempt[]> {
  if (!questionIds.length) return [];
  const rows = await q<any[]>((sql) => sql`
    SELECT question_id, correct, answered_at FROM practice_attempts
     WHERE author_hash = ${authorHash} AND question_id = ANY(${questionIds}::bigint[])
  `);
  return rows.map((r) => ({
    questionId: String(r.question_id),
    correct: !!r.correct,
    answeredAt: new Date(r.answered_at).getTime(),
  }));
}

async function applyStatus(id: string, current: { status: string; report_count: number; answerers: number }) {
  const status = toStored({ ...current, id, question: "", options: [], answer_index: 0 }).status;
  const next = nextStatus({ status, answerers: Number(current.answerers) || 0, reports: Number(current.report_count) || 0 });
  if (next !== status) {
    await q((sql) => sql`
      UPDATE practice_questions SET status = ${next} WHERE id = ${id}::bigint AND status <> 'hidden'
    `);
  }
  return next;
}

/** Record one answer and update the counters; may confirm the question. */
export async function recordAnswer(authorHash: string, questionId: string, correct: boolean): Promise<void> {
  await q((sql) => sql`
    INSERT INTO practice_attempts (author_hash, question_id, correct)
    VALUES (${authorHash}, ${questionId}::bigint, ${correct})
  `);
  const rows = await q<any[]>((sql) => sql`
    UPDATE practice_questions
       SET answer_count = answer_count + 1,
           correct_count = correct_count + ${correct ? 1 : 0}
     WHERE id = ${questionId}::bigint
     RETURNING status, report_count,
       (SELECT count(DISTINCT author_hash) FROM practice_attempts WHERE question_id = ${questionId}::bigint)::int AS answerers
  `);
  if (rows[0]) await applyStatus(questionId, rows[0]);
}

/**
 * One report per student per question (the reports table's primary key
 * enforces it). Returns whether this was a new report and the resulting status.
 */
export async function reportQuestion(
  authorHash: string,
  questionId: string,
): Promise<{ counted: boolean; status: PracticeStatus } | null> {
  const ins = await q<any[]>((sql) => sql`
    INSERT INTO reports (target_kind, target_id, author_hash)
    VALUES ('practice', ${questionId}, ${authorHash})
    ON CONFLICT DO NOTHING
    RETURNING 1
  `);
  const counted = ins.length > 0;
  const rows = counted
    ? await q<any[]>((sql) => sql`
        UPDATE practice_questions SET report_count = report_count + 1
         WHERE id = ${questionId}::bigint
         RETURNING status, report_count,
           (SELECT count(DISTINCT author_hash) FROM practice_attempts WHERE question_id = ${questionId}::bigint)::int AS answerers
      `)
    : await q<any[]>((sql) => sql`
        SELECT status, report_count, 0 AS answerers FROM practice_questions WHERE id = ${questionId}::bigint
      `);
  if (!rows[0]) return null;
  const status = counted ? await applyStatus(questionId, rows[0]) : toStored({ ...rows[0], id: questionId }).status;
  return { counted, status };
}
