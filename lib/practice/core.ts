/**
 * Practice: the pure rules. Question validation and dedupe, spaced-repetition
 * ordering, per-serve option shuffling, the confirm/hide thresholds and the
 * public payload shape. No `@/` alias and no I/O (only node:crypto), so the API
 * routes and `node --test` share exactly this code.
 */
import crypto from "node:crypto";

/* ------------------------------------------------------------ constants --- */

import { BANK_TARGET, BATCH_SIZE, batchSizeFor } from "./targets.ts";

export { BANK_TARGET, BATCH_SIZE, batchSizeFor };
/** Questions in one practice set. */
export const SET_SIZE = 5;
export const OPTION_COUNT = 4;

/** unconfirmed -> confirmed after this many distinct students answered with no report. */
export const CONFIRM_AFTER_ANSWERS = 5;
/** Any status -> hidden after this many distinct reports. */
export const HIDE_AFTER_REPORTS = 3;

/** A missed question comes back 1, then 3, then 7 days on; after that it has graduated. */
export const REVIEW_DAYS = [1, 3, 7] as const;
const DAY = 24 * 60 * 60 * 1000;

export const MAX_QUESTION_CHARS = 300;
export const MIN_QUESTION_CHARS = 10;
export const MAX_OPTION_CHARS = 140;
export const MAX_EXPLANATION_CHARS = 280;

/* ---------------------------------------------------------------- types --- */

export type PracticeStatus = "unconfirmed" | "confirmed" | "hidden";

/** A question as it is stored. answerIndex and explanation never leave the server before an answer. */
export type StoredQuestion = {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  status: PracticeStatus;
};

/** What a browser receives for one question in a set. */
export type ServedQuestion = {
  id: string;
  question: string;
  options: string[];
  status: "unconfirmed" | "confirmed";
};

export type ValidQuestion = {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  hash: string;
};

export type Attempt = { questionId: string; correct: boolean; answeredAt: number };

/** One student's record on one question, folded from their attempts. */
export type History = {
  lastAt: number;
  /** Most recent miss, or null if they have never missed it. */
  missAt: number | null;
  /** Correct answers since that miss. */
  correctSinceMiss: number;
};

/* ---------------------------------------------------------------- text --- */

/** One plain line: tags and entities out, whitespace collapsed. */
export function oneLine(s: unknown): string {
  return String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) =>
      ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[m] ?? m,
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Same canonical form as the quiz answer bank (lib/store/quizAnswers.ts), so
 * two questions that differ only in case, spacing or punctuation are one
 * question. Changing it changes every hash: treat it as a migration.
 */
export function normalizeQuestion(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function hashQuestion(raw: string): string {
  return crypto.createHash("sha256").update(normalizeQuestion(raw)).digest("hex");
}

/** "A) Paris" / "b. Paris" / "(c) Paris" -> "Paris". Models add letters despite being told not to. */
function stripOptionLetter(s: string): string {
  return s.replace(/^\(?[a-dA-D][.):]\s+/, "").trim();
}

/** Options that point at other options break once the order is shuffled. */
const POSITIONAL = /\b(all|none|both|neither) of the (above|options|following)\b|\b(both|either) [a-d] (and|or) [a-d]\b|\boption [a-d]\b/i;

/* ----------------------------------------------------------- validation --- */

/**
 * Check one generated question. Returns the cleaned question or null. Rules:
 * a real question of sane length, exactly four distinct non-empty options, an
 * in-range integer answer index, a non-empty one-line explanation, and no
 * "all of the above" style option (meaningless after shuffling).
 */
export function validateQuestion(raw: unknown): ValidQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const question = oneLine(r.question);
  if (question.length < MIN_QUESTION_CHARS || question.length > MAX_QUESTION_CHARS) return null;
  if (!normalizeQuestion(question)) return null;

  if (!Array.isArray(r.options) || r.options.length !== OPTION_COUNT) return null;
  const options = r.options.map((o) => (typeof o === "string" ? stripOptionLetter(oneLine(o)) : ""));
  if (options.some((o) => !o || o.length > MAX_OPTION_CHARS || POSITIONAL.test(o))) return null;
  const keys = new Set(options.map((o) => normalizeQuestion(o) || o.toLowerCase()));
  if (keys.size !== OPTION_COUNT) return null;

  const idx = r.answer_index ?? r.answerIndex;
  if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= OPTION_COUNT) return null;

  const explanation = oneLine(r.explanation);
  if (!explanation || explanation.length > MAX_EXPLANATION_CHARS) return null;

  return { question, options, answerIndex: idx, explanation, hash: hashQuestion(question) };
}

/**
 * Validate a model's whole batch: drop anything malformed, anything already in
 * the bank (`existing` = known question hashes), and repeats within the batch.
 */
export function validateBatch(
  raw: unknown,
  existing: Iterable<string> = [],
  max: number = BANK_TARGET * 2,
): ValidQuestion[] {
  let list: unknown = raw;
  if (list && typeof list === "object" && !Array.isArray(list)) list = (list as any).questions;
  if (!Array.isArray(list)) return [];
  const seen = new Set(existing);
  const out: ValidQuestion[] = [];
  for (const item of list.slice(0, max)) {
    const q = validateQuestion(item);
    if (!q || seen.has(q.hash)) continue;
    seen.add(q.hash);
    out.push(q);
  }
  return out;
}

/**
 * Parse the model's text (schema-forced JSON, but be forgiving about a fence).
 * If the JSON does not parse, usually because the output hit the token limit
 * mid-question, salvage what is complete: the notes string if it closed, and
 * every question object that closed. The cut-off one is dropped, so a
 * truncated batch keeps its valid questions instead of failing the week.
 */
export function parseBatchText(text: string | null | undefined): unknown {
  if (!text) return null;
  let t = text.trim();
  const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (m) t = m[0];
  try {
    return JSON.parse(t);
  } catch {
    return salvageBatch(text);
  }
}

/** Complete top-level objects inside the array that starts at `from` (the index of its "["). */
function completeObjects(s: string, from: number): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(s.slice(start, i + 1)));
        } catch {
          /* malformed: skip it */
        }
        start = -1;
      }
      if (depth < 0) break;
    } else if (c === "]" && depth === 0) break;
  }
  return out;
}

export function salvageBatch(text: string): { notes?: string; questions: unknown[] } | null {
  const arr = text.search(/"questions"\s*:\s*\[/);
  const questions = arr >= 0 ? completeObjects(text, text.indexOf("[", arr)) : [];
  let notes: string | undefined;
  const n = text.match(/"notes"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (n) {
    try {
      notes = JSON.parse(n[1]);
    } catch {
      notes = undefined;
    }
  }
  if (!questions.length && notes === undefined) return null;
  return notes === undefined ? { questions } : { notes, questions };
}

/* ----------------------------------------------------- spaced repetition --- */

/** Fold one student's attempts into a per-question history. Order of input does not matter. */
export function historiesFrom(attempts: Attempt[]): Map<string, History> {
  const sorted = [...attempts].sort((a, b) => a.answeredAt - b.answeredAt);
  const out = new Map<string, History>();
  for (const a of sorted) {
    const h = out.get(a.questionId) ?? { lastAt: 0, missAt: null, correctSinceMiss: 0 };
    h.lastAt = a.answeredAt;
    if (a.correct) {
      if (h.missAt !== null) h.correctSinceMiss += 1;
    } else {
      h.missAt = a.answeredAt;
      h.correctSinceMiss = 0;
    }
    out.set(a.questionId, h);
  }
  return out;
}

/**
 * When a missed question is due again, or null if it is not in review (never
 * missed, or answered right on all three reviews). Review k is due REVIEW_DAYS[k]
 * after the miss, and never sooner than a day after the last answer, so a
 * student who comes back late does not get the same question twice in a row.
 */
export function dueAt(h: History | undefined): number | null {
  if (!h || h.missAt === null || h.correctSinceMiss >= REVIEW_DAYS.length) return null;
  return Math.max(h.missAt + REVIEW_DAYS[h.correctSinceMiss] * DAY, h.lastAt + DAY);
}

export type Rng = () => number;

export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Choose a set: questions this student missed that are due again (most overdue
 * first), then ones they have never seen (in random order), then the rest
 * (longest since last answered first). Hidden questions are never served.
 */
export function pickSet<Q extends { id: string; status: PracticeStatus }>(
  questions: Q[],
  histories: Map<string, History>,
  now: number,
  size: number = SET_SIZE,
  rng: Rng = Math.random,
): Q[] {
  const live = questions.filter((q) => q.status !== "hidden");
  const due: { q: Q; at: number }[] = [];
  const unseen: Q[] = [];
  const rest: { q: Q; at: number }[] = [];
  for (const q of live) {
    const h = histories.get(q.id);
    if (!h) {
      unseen.push(q);
      continue;
    }
    const d = dueAt(h);
    if (d !== null && d <= now) due.push({ q, at: d });
    else rest.push({ q, at: h.lastAt });
  }
  due.sort((a, b) => a.at - b.at);
  rest.sort((a, b) => a.at - b.at);
  return [...due.map((x) => x.q), ...shuffle(unseen, rng), ...rest.map((x) => x.q)].slice(0, size);
}

/* ---------------------------------------------------------- serving --- */

/**
 * The public shape of a question: text and freshly shuffled options. Mapped
 * field by field on purpose, so the answer index, the explanation, counters or
 * the generator's hash can never ride along.
 */
export function toServed(q: StoredQuestion, rng: Rng = Math.random): ServedQuestion {
  return {
    id: String(q.id),
    question: q.question,
    options: shuffle(q.options, rng),
    status: q.status === "confirmed" ? "confirmed" : "unconfirmed",
  };
}

/** Answers are matched by option text, so a per-serve shuffle cannot turn a right answer wrong. */
export function isCorrectChoice(q: Pick<StoredQuestion, "options" | "answerIndex">, choice: unknown): boolean {
  if (typeof choice !== "string") return false;
  const right = q.options[q.answerIndex];
  return typeof right === "string" && choice.trim() === right.trim();
}

/* ------------------------------------------------------------ quality --- */

/**
 * Status after an answer or a report. Hidden is final. Three distinct reports
 * hide a question whatever its status; an unconfirmed question with no reports
 * is confirmed once five distinct students have answered it.
 */
export function nextStatus(s: { status: PracticeStatus; answerers: number; reports: number }): PracticeStatus {
  if (s.status === "hidden" || s.reports >= HIDE_AFTER_REPORTS) return "hidden";
  if (s.status === "unconfirmed" && s.reports === 0 && s.answerers >= CONFIRM_AFTER_ANSWERS) return "confirmed";
  return s.status;
}

/* ---------------------------------------------------------- input checks --- */

/** Course codes as lib/moodle/courses.ts codeOf() writes them: "cos202". */
export function cleanCourseCode(v: unknown): string | null {
  return typeof v === "string" && /^[a-z]{2,5}\d{3}$/.test(v) ? v : null;
}

export function cleanWeek(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n < 100 ? n : null;
}

export function cleanQuestionId(v: unknown): string | null {
  const s = typeof v === "number" ? String(v) : v;
  return typeof s === "string" && /^\d{1,18}$/.test(s) ? s : null;
}

/**
 * A Gemini API key, loosely shaped (AI Studio keys are "AIza" + 35 chars).
 * Only a shape check, so an obviously wrong paste fails fast with a clear
 * message instead of a round trip to Google.
 */
export function cleanApiKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const k = v.trim();
  return /^[A-Za-z0-9_\-]{30,60}$/.test(k) ? k : null;
}
