/**
 * Read the questions out of an UNGRADED quiz, without answering it.
 *
 * Two sources, in order of preference:
 *   1. review.php of a previously finished attempt — pure read, no LMS mutation.
 *   2. a fresh attempt via startattempt.php, which is *opened and left open*
 *      (never saved, never submitted) purely to read the question text. Only
 *      done when the caller passes openAttempts, because it consumes one of the
 *      quiz's allowed attempts.
 *
 * Graded quizzes are refused outright — same name gate the autopilot uses.
 */
import { LMS, type MoodleSession } from "@/lib/moodle/auth";
import {
  fetchPage,
  getQuizStatus,
  isUngradedName,
  startAttempt,
  type ParsedQuestion,
} from "@/lib/moodle/quiz";
import { stripTags } from "./html";

export type QuizSource = "review" | "attempt" | "none";

export interface QuizDump {
  cmid: number;
  name: string;
  source: QuizSource;
  questions: ParsedQuestion[];
  /** Human-readable reason when questions are empty. */
  skipped: string | null;
}

const MAX_PAGES = 30;

/** Parse question stems + options out of attempt OR review HTML. */
export function parseQuestions(html: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = [];
  const parts = html.split(/<div id="question-\d+-\d+"/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const cls = (block.match(/class="que ([^"]*)"/) || [])[1] || "";
    const qtype = cls.split(/\s+/)[0] || "";
    const fieldBase = (block.match(/name="(q\d+:\d+)_answer"/) || [])[1] || "";
    const qtext =
      (block.match(/<div class="qtext">([\s\S]*?)<\/div>\s*<\/div>\s*<fieldset/) ||
        block.match(/<div class="qtext">([\s\S]*?)<\/div>/) ||
        [])[1] || "";
    const text = stripTags(qtext);
    if (!text) continue;
    out.push({
      fieldBase,
      qtype,
      text,
      options: parseOptions(block),
      multiple: /name="q\d+:\d+_choice\d+"/.test(block),
    });
  }
  return out;
}

/**
 * Options live in the answer list. Attempt pages render enabled radios; review
 * pages render the same list with the inputs disabled (and sometimes dropped
 * entirely), so fall back to the answer rows themselves.
 */
function parseOptions(block: string): { value: string; text: string }[] {
  const options: { value: string; text: string }[] = [];
  const seen = new Set<string>();

  const answerList = (block.match(/<div class="answer"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/) ||
    block.match(/<div class="answer"[^>]*>([\s\S]*)/) || [])[1] || block;

  // Row-based: each option is <div class="r0 ..."> / <div class="r1 ...">.
  const rowRe = /<div class="r[01][^"]*"[^>]*>([\s\S]*?)(?=<div class="r[01][^"]*"|$)/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(answerList))) {
    const row = rm[1];
    const value = (row.match(/value="(-?\d+)"/) || [])[1] ?? String(options.length);
    if (value === "-1") continue; // "clear my choice"
    const flex = row.match(/class="flex-fill[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const label = stripTags(flex ? flex[1] : row).replace(/^[a-z][.)]\s*/i, "");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    options.push({ value, text: label });
  }
  if (options.length) return options;

  // Label-based fallback: <label for="...answerN">text</label>.
  const labRe = /<label[^>]*for="q\d+:\d+_answer(\d+)"[^>]*>([\s\S]*?)<\/label>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = labRe.exec(block))) {
    const label = stripTags(lm[2]).replace(/^[a-z][.)]\s*/i, "");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    options.push({ value: lm[1], text: label });
  }
  return options;
}

/** Read one quiz's questions. Never throws. */
export async function dumpQuiz(
  session: MoodleSession,
  cmid: number,
  name: string,
  openAttempts: boolean,
): Promise<QuizDump> {
  const base: QuizDump = { cmid, name, source: "none", questions: [], skipped: null };
  if (!isUngradedName(name)) {
    return { ...base, skipped: "graded or unrecognised quiz — never exported" };
  }

  try {
    const status = await getQuizStatus(session, cmid);

    if (status.lastReviewAttemptId) {
      const review = await fetchPage(
        session,
        `${LMS}/mod/quiz/review.php?attempt=${status.lastReviewAttemptId}&showall=1`,
      );
      const questions = parseQuestions(review.html);
      if (questions.length) return { ...base, source: "review", questions };
    }

    if (!openAttempts) {
      return {
        ...base,
        skipped: "never attempted — enable “open unattempted quizzes” to read its questions",
      };
    }
    if (!status.canAttempt) return { ...base, skipped: status.reason };

    const page = await startAttempt(session, cmid);
    if (!page) return { ...base, skipped: "could not open an attempt" };

    const questions: ParsedQuestion[] = [];
    const seen = new Set<string>();
    const add = (list: ParsedQuestion[]) => {
      for (const q of list) {
        const key = q.fieldBase || q.text.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        questions.push(q);
      }
    };
    add(page.questions);

    for (let p = 1; p < MAX_PAGES; p++) {
      const next = await fetchPage(
        session,
        `${LMS}/mod/quiz/attempt.php?attempt=${page.attemptId}&cmid=${cmid}&page=${p}`,
      );
      const parsed = parseQuestions(next.html);
      const before = questions.length;
      add(parsed);
      if (questions.length === before) break; // no new questions -> past the last page
    }

    if (!questions.length) return { ...base, skipped: "attempt page had no readable questions" };
    return { ...base, source: "attempt", questions };
  } catch (e: any) {
    return { ...base, skipped: e?.message || "quiz read failed" };
  }
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Render one quiz as study-ready markdown. Questions and options only. */
export function renderQuizMarkdown(
  dump: QuizDump,
  courseName: string,
  exportedOn: string,
): string {
  const lines: string[] = [
    `# ${dump.name}`,
    "",
    `_${courseName} · ungraded practice quiz · exported from Miva LMS on ${exportedOn}_`,
    "",
    `Questions and options only — no answers. ${dump.questions.length} question${
      dump.questions.length === 1 ? "" : "s"
    }.`,
    "",
    "---",
    "",
  ];

  dump.questions.forEach((q, i) => {
    lines.push(`### ${i + 1}. ${q.text}`);
    lines.push("");
    if (q.options.length) {
      if (q.multiple) lines.push("_Select all that apply._", "");
      q.options.forEach((o, oi) => {
        lines.push(`- **${LETTERS[oi] || oi + 1}.** ${o.text}`);
      });
    } else {
      lines.push(`_(${q.qtype || "open"} question — write your own answer)_`);
    }
    lines.push("");
  });

  return lines.join("\n").trimEnd() + "\n";
}
