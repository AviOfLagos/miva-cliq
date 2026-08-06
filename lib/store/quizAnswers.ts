/**
 * Shared answer bank for UNGRADED quizzes.
 *
 * Identity is a hash of the normalized question TEXT, never a question/option
 * position — Moodle randomizes option order per attempt and draws different
 * questions per student, so text is the only stable join key. The same question
 * therefore dedupes across attempts, weeks, and students automatically.
 *
 * Anonymity: `author_hash` (last contributor, for abuse control) is stored but
 * never returned — `toPublic` is the only path a row becomes a response.
 *
 * Nothing graded is ever written here; the ungraded guard lives in lib/quiz/run.ts
 * before any attempt is made.
 */
import crypto from "crypto";
import { getDb } from "./db";

/** Promote unconfirmed -> confirmed once this many independent confirmations land. */
export const CONFIRM_THRESHOLD = 2;
/** Demote confirmed -> unconfirmed once refutes reach this many. */
export const REFUTE_THRESHOLD = 2;
export const PAGE_SIZE = 30;

/** Option-based question types we can safely answer. Everything else is skipped. */
export const OPTION_QTYPES = new Set(["multichoice", "truefalse"]);

export type AnswerStatus = "unconfirmed" | "confirmed";
export type AnswerSource = "ai" | "attempt" | "edit";

export type QuizAnswer = {
  questionHash: string;
  questionText: string;
  qtype: string;
  answerText: string;
  answerMulti: string[] | null;
  status: AnswerStatus;
  confirmCount: number;
  refuteCount: number;
  courseCode: string | null;
  department: string | null;
  section: number | null;
  semester: string | null;
  year: number | null;
  source: AnswerSource;
  createdAt: number;
  updatedAt: number;
};

type AnswerRow = {
  question_hash: string;
  question_text: string;
  qtype: string;
  answer_text: string;
  answer_multi: string[] | null;
  status: string;
  confirm_count: number;
  refute_count: number;
  course_code: string | null;
  department: string | null;
  section: number | null;
  semester: string | null;
  year: number | null;
  source: string;
  created_at: string;
  updated_at: string;
};

/** Browse metadata carried alongside an answer. All optional. */
export type AnswerMeta = {
  courseCode?: string | null;
  department?: string | null;
  section?: number | null;
  semester?: string | null;
  year?: number | null;
};

/**
 * Canonicalize question text so trivial differences (whitespace, case, HTML
 * entities, punctuation) hash to the same key. Deliberately lossy — two
 * questions that differ only in formatting are the same question.
 */
export function normalizeQuestion(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ") // strip any HTML tags
    .replace(/&[a-z]+;|&#\d+;/gi, " ") // strip HTML entities
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // punctuation -> space
    .trim()
    .replace(/\s+/g, " ");
}

export function hashQuestion(raw: string): string {
  return crypto.createHash("sha256").update(normalizeQuestion(raw)).digest("hex");
}

function toPublic(r: AnswerRow): QuizAnswer {
  return {
    questionHash: r.question_hash,
    questionText: r.question_text,
    qtype: r.qtype,
    answerText: r.answer_text,
    answerMulti: r.answer_multi ?? null,
    status: r.status === "confirmed" ? "confirmed" : "unconfirmed",
    confirmCount: Number(r.confirm_count) || 0,
    refuteCount: Number(r.refute_count) || 0,
    courseCode: r.course_code,
    department: r.department,
    section: r.section === null ? null : Number(r.section),
    semester: r.semester,
    year: r.year === null ? null : Number(r.year),
    source: (r.source as AnswerSource) || "ai",
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

/**
 * Bank-first read: fetch every cached answer for a whole quiz in one query,
 * returned as a hash->answer map so the runner never calls the AI for a question
 * it already knows.
 */
export async function lookupAnswers(
  hashes: string[],
): Promise<Map<string, QuizAnswer>> {
  const out = new Map<string, QuizAnswer>();
  const sql = getDb();
  if (!sql || hashes.length === 0) return out;
  try {
    const rows = (await sql`
      SELECT * FROM quiz_answers WHERE question_hash = ANY(${hashes})
    `) as AnswerRow[];
    for (const r of rows) out.set(r.question_hash, toPublic(r));
  } catch {
    // A read failure just means "no cache" — the runner falls back to AI.
  }
  return out;
}

export async function getAnswer(hash: string): Promise<QuizAnswer | null> {
  const sql = getDb();
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT * FROM quiz_answers WHERE question_hash = ${hash}
    `) as AnswerRow[];
    return rows[0] ? toPublic(rows[0]) : null;
  } catch {
    return null;
  }
}

export type UpsertInput = {
  questionText: string;
  qtype: string;
  answerText: string;
  answerMulti?: string[] | null;
  meta?: AnswerMeta;
  source: AnswerSource;
  authorHash?: string | null;
  /** A real attempt review or a human edit is authoritative -> mark confirmed. */
  confirmed?: boolean;
};

/**
 * Insert or replace the cached answer for a question. Metadata is filled only
 * when the incoming row provides it (COALESCE), so an AI seed doesn't wipe
 * course/department tags a later attempt supplied.
 *
 * An authoritative source (attempt review, edit) sets status=confirmed and bumps
 * confirm_count; an AI guess only fills a gap and stays unconfirmed.
 */
export async function upsertAnswer(input: UpsertInput): Promise<QuizAnswer | null> {
  const sql = getDb();
  if (!sql) return null;
  const hash = hashQuestion(input.questionText);
  const status = input.confirmed ? "confirmed" : "unconfirmed";
  const confirmBump = input.confirmed ? 1 : 0;
  const multi = input.answerMulti ? JSON.stringify(input.answerMulti) : null;
  const m = input.meta ?? {};
  try {
    const rows = (await sql`
      INSERT INTO quiz_answers (
        question_hash, question_text, qtype, answer_text, answer_multi,
        status, confirm_count, course_code, department, section, semester, year,
        source, author_hash
      ) VALUES (
        ${hash}, ${input.questionText}, ${input.qtype}, ${input.answerText}, ${multi}::jsonb,
        ${status}, ${confirmBump}, ${m.courseCode ?? null}, ${m.department ?? null},
        ${m.section ?? null}, ${m.semester ?? null}, ${m.year ?? null},
        ${input.source}, ${input.authorHash ?? null}
      )
      ON CONFLICT (question_hash) DO UPDATE SET
        answer_text  = EXCLUDED.answer_text,
        answer_multi = EXCLUDED.answer_multi,
        qtype        = EXCLUDED.qtype,
        status       = CASE WHEN ${input.confirmed} THEN 'confirmed'
                            ELSE quiz_answers.status END,
        confirm_count = quiz_answers.confirm_count + ${confirmBump},
        course_code  = COALESCE(EXCLUDED.course_code, quiz_answers.course_code),
        department   = COALESCE(EXCLUDED.department, quiz_answers.department),
        section      = COALESCE(EXCLUDED.section, quiz_answers.section),
        semester     = COALESCE(EXCLUDED.semester, quiz_answers.semester),
        year         = COALESCE(EXCLUDED.year, quiz_answers.year),
        source       = EXCLUDED.source,
        author_hash  = COALESCE(EXCLUDED.author_hash, quiz_answers.author_hash),
        updated_at   = now()
      RETURNING *
    `) as AnswerRow[];
    return rows[0] ? toPublic(rows[0]) : null;
  } catch {
    return null;
  }
}

/**
 * A human edit: authoritative, so it sets the answer, marks it confirmed, and
 * records the contributor. Keyed by hash (the question text isn't re-sent).
 */
export async function editAnswer(
  hash: string,
  answerText: string,
  authorHash: string,
): Promise<QuizAnswer | null> {
  const sql = getDb();
  if (!sql) return null;
  const clean = answerText.trim();
  if (!clean) return null;
  try {
    const rows = (await sql`
      UPDATE quiz_answers
         SET answer_text = ${clean},
             status = 'confirmed',
             confirm_count = confirm_count + 1,
             source = 'edit',
             author_hash = ${authorHash},
             updated_at = now()
       WHERE question_hash = ${hash}
      RETURNING *
    `) as AnswerRow[];
    return rows[0] ? toPublic(rows[0]) : null;
  } catch {
    return null;
  }
}

/** One vote that the cached answer is correct. Promotes to confirmed at threshold. */
export async function confirmAnswer(hash: string): Promise<QuizAnswer | null> {
  const sql = getDb();
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE quiz_answers
         SET confirm_count = confirm_count + 1,
             status = CASE WHEN confirm_count + 1 >= ${CONFIRM_THRESHOLD}
                           THEN 'confirmed' ELSE status END,
             updated_at = now()
       WHERE question_hash = ${hash}
      RETURNING *
    `) as AnswerRow[];
    return rows[0] ? toPublic(rows[0]) : null;
  } catch {
    return null;
  }
}

/** One vote that the cached answer is wrong. Demotes to unconfirmed at threshold. */
export async function refuteAnswer(hash: string): Promise<QuizAnswer | null> {
  const sql = getDb();
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE quiz_answers
         SET refute_count = refute_count + 1,
             status = CASE WHEN refute_count + 1 >= ${REFUTE_THRESHOLD}
                           THEN 'unconfirmed' ELSE status END,
             updated_at = now()
       WHERE question_hash = ${hash}
      RETURNING *
    `) as AnswerRow[];
    return rows[0] ? toPublic(rows[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Paged browse for the answer-bank UI. Newest-updated first, optionally narrowed
 * by course code / department / section. Filters are nullable bind params, never
 * concatenated SQL.
 */
export async function listAnswers(opts: {
  courseCode?: string | null;
  department?: string | null;
  section?: number | null;
  before?: number | null;
}): Promise<QuizAnswer[]> {
  const sql = getDb();
  if (!sql) return [];
  const courseCode = opts.courseCode ?? null;
  const department = opts.department ?? null;
  const section = opts.section ?? null;
  const before = opts.before ? new Date(opts.before).toISOString() : null;
  try {
    const rows = (await sql`
      SELECT * FROM quiz_answers
       WHERE (${courseCode}::text IS NULL OR course_code = ${courseCode})
         AND (${department}::text IS NULL OR department = ${department})
         AND (${section}::int IS NULL OR section = ${section})
         AND (${before}::timestamptz IS NULL OR updated_at < ${before})
       ORDER BY updated_at DESC
       LIMIT ${PAGE_SIZE}
    `) as AnswerRow[];
    return rows.map(toPublic);
  } catch {
    return [];
  }
}
