/**
 * Moodle quiz attempt lifecycle for UNGRADED quizzes.
 *
 * Miva's Moodle does NOT expose the mod_quiz_* web-service functions
 * (servicenotavailable), so quizzes are driven exactly the way a browser does:
 * plain page requests to /mod/quiz/*.php, scraping the attempt HTML.
 * Confirmed against the live LMS (see the dev quiz-probe route):
 *
 *   start:   POST /mod/quiz/startattempt.php  {cmid, sesskey}
 *            -> 303 -> /mod/quiz/attempt.php?attempt=<id>&cmid=<cmid>
 *   answer:  radios named  q<usage>:<slot>_answer   (values 0..n; -1 = clear)
 *            hidden per q:  q<usage>:<slot>_:sequencecheck , _:flagged  (must echo back)
 *   submit:  POST /mod/quiz/processattempt.php?cmid=<cmid>  {all hidden + answers + finishattempt:1}
 *   review:  GET  /mod/quiz/review.php?attempt=<id>   (correct answers, when review is enabled)
 */
import { LMS, cookieHeader, type MoodleSession } from "./auth";

/** Graded quizzes are named "(Graded)" / mid-sem / exam at Miva; practice ones "(Ungraded)". */
const GRADED_NAME = /\(graded\)|mid[-\s]?sem|end[-\s]?sem|end of semester|\bfinal\b|\bexam\b|lab assessment/i;
const UNGRADED_NAME = /\(ungraded\)|practice assessment|practice test|pre[-\s]?semester|post[-\s]?semester/i;

/**
 * Name-based ungraded gate. Web-services are off so we can't read the gradebook;
 * Miva names quizzes explicitly, and we DEFAULT TO SKIP unless the name clearly
 * marks the quiz ungraded/practice. Anything that looks graded is always skipped.
 */
export function isUngradedName(name: string): boolean {
  if (GRADED_NAME.test(name)) return false;
  return UNGRADED_NAME.test(name);
}

export interface ParsedQuestion {
  /** Field base, e.g. "q5243316:3". answer field = base+"_answer". */
  fieldBase: string;
  qtype: string; // multichoice | truefalse | essay | shortanswer | numerical | ...
  text: string; // question stem, plain text
  options: { value: string; text: string }[]; // empty for non-option qtypes
  multiple: boolean;
}

export interface AttemptPage {
  attemptId: number;
  cmid: number;
  finalUrl: string;
  questions: ParsedQuestion[];
  /** Every hidden field on the response form (sequencecheck, flagged, attempt, etc). */
  hidden: Record<string, string>;
}

export function isOptionQuestion(q: ParsedQuestion): boolean {
  return q.options.length > 0 && (q.qtype === "multichoice" || q.qtype === "truefalse");
}

export async function fetchPage(
  session: MoodleSession,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; finalUrl: string; html: string }> {
  const r = await fetch(url, {
    ...init,
    headers: {
      cookie: cookieHeader(session.cookies),
      "user-agent": "Mozilla/5.0",
      ...(init?.headers || {}),
    },
    redirect: "follow",
  });
  const html = await r.text().catch(() => "");
  return { status: r.status, finalUrl: r.url, html };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Extract every hidden input on the page (name -> value). */
function extractHidden(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]*type="hidden"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const name = (tag.match(/name="([^"]+)"/) || [])[1];
    const value = (tag.match(/value="([^"]*)"/) || [])[1] ?? "";
    if (name) out[name] = decodeEntities(value);
  }
  return out;
}

/** Parse one question block (already sliced from the attempt HTML). */
function parseQuestionBlock(block: string): ParsedQuestion | null {
  const cls = (block.match(/class="que ([^"]*)"/) || [])[1] || "";
  const qtype = cls.split(/\s+/)[0] || "";
  const baseMatch = block.match(/name="(q\d+:\d+)_answer"/);
  const fieldBase = baseMatch ? baseMatch[1] : "";

  const qtext = (block.match(/<div class="qtext">([\s\S]*?)<\/div>\s*<\/div>\s*<fieldset/) ||
    block.match(/<div class="qtext">([\s\S]*?)<\/div>/) || [])[1] || "";
  const text = stripTags(qtext);

  // Multi-answer multichoice uses checkbox fields named "<base>_choiceN". The
  // per-question "flag" checkbox (name "<base>_:flagged") is NOT that — exclude it.
  const multiple = /name="q\d+:\d+_choice\d+"/.test(block);

  const options: { value: string; text: string }[] = [];
  // Radio options: <input type="radio" name="<base>_answer" value="X" id="<base>_answerX" ...>
  const optRe = /<input[^>]*type="radio"[^>]*name="(q\d+:\d+_answer)"[^>]*value="([^"]*)"[^>]*>/gi;
  let om: RegExpExecArray | null;
  while ((om = optRe.exec(block))) {
    const value = om[2];
    if (value === "-1" || value === "") continue; // "clear my choice"
    // Label sits in a div with id="<base>value_label" (data-region="answer-label").
    const labelId = `${fieldBase}_answer${value}_label`;
    const li = block.indexOf(`id="${labelId}"`);
    let label = "";
    if (li >= 0) {
      const seg = block.slice(li, li + 800);
      // Text is inside .flex-fill (a <p> or <div class="answer_text">).
      const flex = seg.match(/class="flex-fill[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/) ||
        seg.match(/class="flex-fill[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      label = stripTags(flex ? flex[1] : seg).replace(/^[a-z]\.\s*/i, "");
    }
    options.push({ value, text: label });
  }

  if (!fieldBase && options.length === 0) return null;
  return { fieldBase, qtype, text, options, multiple };
}

/** Parse all questions + hidden fields from an attempt page. */
export function parseAttemptHtml(html: string, finalUrl: string, cmid: number): AttemptPage {
  const attemptId = Number((finalUrl.match(/attempt=(\d+)/) || [])[1]) || 0;
  const hidden = extractHidden(html);
  const questions: ParsedQuestion[] = [];
  // Each question is <div id="question-<usage>-<slot>" class="que ...">.
  const parts = html.split(/<div id="question-\d+-\d+"/);
  for (let i = 1; i < parts.length; i++) {
    const q = parseQuestionBlock(parts[i]);
    if (q) questions.push(q);
  }
  return { attemptId, cmid, finalUrl, questions, hidden };
}

export interface QuizStatus {
  name: string;
  /** Can we start/continue an attempt? False when attempts are exhausted/closed. */
  canAttempt: boolean;
  reason: string;
  /** Newest finished attempt's id, if any — its review can seed the bank without
   *  a new attempt (e.g. when attempts are maxed out). */
  lastReviewAttemptId: number | null;
}

/**
 * Read the quiz view page to decide whether an attempt is even possible before
 * we POST anything, and to find a prior finished attempt whose review we can
 * still learn from. Attempts are exhausted / the quiz is closed when there's no
 * startattempt form and no in-progress "Continue" link.
 */
export async function getQuizStatus(
  session: MoodleSession,
  cmid: number,
): Promise<QuizStatus> {
  const view = await fetchPage(session, `${LMS}/mod/quiz/view.php?id=${cmid}`);
  const html = view.html;
  const name = (html.match(/<title>([^<]*)<\/title>/) || [])[1]?.split("|")[0].trim() || "";
  const hasStartForm = /action="[^"]*\/mod\/quiz\/startattempt\.php"/.test(html);
  const hasContinue = /\/mod\/quiz\/attempt\.php\?/.test(html);
  const noMore = /No more attempts are allowed|no longer available|not available/i.test(html);
  const canAttempt = (hasStartForm || hasContinue) && !noMore;
  // Review links on the attempts table -> the last is the newest finished attempt.
  const reviewIds = Array.from(html.matchAll(/review\.php\?attempt=(\d+)/g)).map((m) => Number(m[1]));
  const lastReviewAttemptId = reviewIds.length ? reviewIds[reviewIds.length - 1] : null;
  return {
    name,
    canAttempt,
    reason: canAttempt ? "ok" : noMore ? "attempts exhausted / closed" : "no attempt available",
    lastReviewAttemptId,
  };
}

/** Start (or resume) an attempt and return the parsed attempt page. */
export async function startAttempt(
  session: MoodleSession,
  cmid: number,
): Promise<AttemptPage | null> {
  const body = new URLSearchParams({ cmid: String(cmid), sesskey: session.sesskey });
  const started = await fetchPage(session, `${LMS}/mod/quiz/startattempt.php`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: `${LMS}/mod/quiz/view.php?id=${cmid}`,
    },
    body: body.toString(),
  });
  if (!/attempt\.php\?/.test(started.finalUrl)) return null;
  return parseAttemptHtml(started.html, started.finalUrl, cmid);
}

export interface SaveResult {
  /** Total questions on the summary. */
  total: number;
  /** How many the summary reports as still "Not yet answered". */
  notAnswered: number;
}

/**
 * Save responses and advance to the summary page WITHOUT finishing. Echoes back
 * every hidden field; `next` is the "Finish attempt" button that makes Moodle
 * process + save the page. Returns the summary's answered/not-answered counts so
 * the caller can verify coverage before committing — this is the on-screen
 * "attempted N of M" check the human sees before the final submit.
 *
 * MUST be separate from the finish: a single processattempt.php with
 * finishattempt=1 finishes the attempt but DISCARDS the responses (verified live:
 * the attempt lands "Finished" but every question reads "Not answered").
 */
export async function saveAnswers(
  session: MoodleSession,
  page: AttemptPage,
  answers: Map<string, string>,
): Promise<SaveResult> {
  const save = new URLSearchParams();
  for (const [k, v] of Object.entries(page.hidden)) save.set(k, v);
  for (const [base, value] of answers) save.set(`${base}_answer`, value);
  save.set("next", "Finish attempt ...");
  await fetchPage(session, `${LMS}/mod/quiz/processattempt.php?cmid=${page.cmid}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", referer: page.finalUrl },
    body: save.toString(),
  });
  // Read the summary and count coverage.
  const summary = await fetchPage(session, `${LMS}/mod/quiz/summary.php?attempt=${page.attemptId}`);
  const notAnswered = (summary.html.match(/Not yet answered/gi) || []).length;
  // Each question is a row linking back into the attempt.
  const total = (summary.html.match(/\/mod\/quiz\/attempt\.php\?attempt=\d+&(amp;)?page=/g) || []).length
    || (summary.html.match(/Not yet answered|Answer saved|Answered/gi) || []).length;
  return { total, notAnswered };
}

/**
 * Finalize a saved attempt (the "Submit all and finish" step). Posts the same
 * fields that form posts. Call only after saveAnswers reports full coverage.
 */
export async function finishAttempt(
  session: MoodleSession,
  page: AttemptPage,
): Promise<boolean> {
  const sesskey = page.hidden.sesskey || session.sesskey;
  const fin = new URLSearchParams({
    attempt: String(page.attemptId),
    finishattempt: "1",
    timeup: "0",
    cmid: String(page.cmid),
    sesskey,
  });
  const res = await fetchPage(session, `${LMS}/mod/quiz/processattempt.php?cmid=${page.cmid}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: `${LMS}/mod/quiz/summary.php?attempt=${page.attemptId}`,
    },
    body: fin.toString(),
  });
  return /review\.php|view\.php/.test(res.finalUrl) || res.status === 200;
}

export interface ReviewedQuestion {
  text: string;
  qtype: string;
  correctText: string | null;
}

/** Read a finished attempt's review; correct answers present only if review is enabled. */
export async function getReview(
  session: MoodleSession,
  attemptId: number,
): Promise<ReviewedQuestion[]> {
  const page = await fetchPage(session, `${LMS}/mod/quiz/review.php?attempt=${attemptId}`);
  const out: ReviewedQuestion[] = [];
  const parts = page.html.split(/<div id="question-\d+-\d+"/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const cls = (block.match(/class="que ([^"]*)"/) || [])[1] || "";
    const qtype = cls.split(/\s+/)[0] || "";
    const qtext = (block.match(/<div class="qtext">([\s\S]*?)<\/div>/) || [])[1] || "";
    const rightBlock = (block.match(/<div class="rightanswer"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "";
    const correctText = rightBlock
      ? stripTags(rightBlock).replace(/^the correct answers?\s*(is|are)\s*:?\s*/i, "").trim() || null
      : null;
    out.push({ text: stripTags(qtext), qtype, correctText });
  }
  return out;
}
