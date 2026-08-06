/**
 * Answer one UNGRADED quiz: bank-first, AI for gaps, a fallback so no answerable
 * question is left blank, then verify coverage on the summary screen BEFORE
 * finishing. Only place a quiz attempt is ever made; refuses anything not clearly
 * ungraded/practice.
 *
 * Flow:
 *   1. name guard: not clearly ungraded => skipped.
 *   2. attempts guard: exhausted/closed => skipped (no wasted POST).
 *   3. start attempt, parse questions.
 *   4. per option-question: confirmed cache -> AI (retried) -> first-option fallback.
 *      Every option question ends up with an answer. Non-option qtypes are skipped.
 *   5. save (no finish) -> read the summary's answered/not-answered count.
 *   6. finish ONLY if every option question is covered; else report, don't submit.
 *   7. read review -> confirm answers into the bank.
 */
import type { MoodleSession } from "../moodle/auth";
import type { Activity } from "../moodle/activities";
import {
  isUngradedName,
  isOptionQuestion,
  getQuizStatus,
  startAttempt,
  saveAnswers,
  finishAttempt,
  getReview,
  type ParsedQuestion,
} from "../moodle/quiz";
import {
  lookupAnswers,
  upsertAnswer,
  hashQuestion,
  normalizeQuestion,
  type AnswerMeta,
  type QuizAnswer,
} from "../store/quizAnswers";
import { answerMcq, aiConfigured } from "../ai/provider";

export type QuizOutcome = "done" | "skipped" | "partial" | "failed";
export interface QuizResult {
  outcome: QuizOutcome;
  detail?: string;
}

/** The option value whose text matches a cached answer, or null. */
function valueForCachedAnswer(q: ParsedQuestion, cached: QuizAnswer): string | null {
  const want = normalizeQuestion(cached.answerText);
  const hit = q.options.find((o) => normalizeQuestion(o.text) === want);
  return hit ? hit.value : null;
}

export async function answerQuiz(
  session: MoodleSession,
  _courseId: number,
  activity: Activity,
  extraMeta: Partial<AnswerMeta> = {},
): Promise<QuizResult> {
  // 1) HARD GUARD — only clearly ungraded/practice quizzes.
  if (!isUngradedName(activity.name)) {
    return { outcome: "skipped", detail: "not clearly ungraded — left for you" };
  }

  const bankMeta: AnswerMeta = {
    section: activity.section ?? null,
    courseCode: extraMeta.courseCode ?? null,
    department: extraMeta.department ?? null,
    semester: extraMeta.semester ?? null,
    year: extraMeta.year ?? null,
  };

  // 2) Attempts guard. If we can't attempt (maxed out / closed) but there's a
  //    prior finished attempt, still harvest its review into the bank so the
  //    user gets the answers to study on /answers.
  const status = await getQuizStatus(session, activity.cmid);
  if (!status.canAttempt) {
    if (status.lastReviewAttemptId) {
      const n = await learnFromReview(session, status.lastReviewAttemptId, bankMeta).catch(() => 0);
      return {
        outcome: "skipped",
        detail: n
          ? `attempts used — saved ${n} answers from your last attempt to /answers`
          : status.reason,
      };
    }
    return { outcome: "skipped", detail: status.reason };
  }

  const page = await startAttempt(session, activity.cmid);
  if (!page) return { outcome: "failed", detail: "could not start attempt" };

  const optionQs = page.questions.filter(isOptionQuestion);
  const nonOption = page.questions.length - optionQs.length;
  if (!optionQs.length) return { outcome: "skipped", detail: "no option-based questions" };

  const cache = await lookupAnswers(optionQs.map((q) => hashQuestion(q.text)));

  const answers = new Map<string, string>(); // fieldBase -> chosen option value
  let fromCache = 0;
  let fromAi = 0;
  let fromFallback = 0;

  for (const q of optionQs) {
    // a) confirmed cache hit
    const cached = cache.get(hashQuestion(q.text));
    if (cached && cached.status === "confirmed") {
      const value = valueForCachedAnswer(q, cached);
      if (value !== null) {
        answers.set(q.fieldBase, value);
        fromCache++;
        continue;
      }
    }

    // b) AI (already retried inside answerMcq)
    if (aiConfigured()) {
      const ai = await answerMcq({
        question: q.text,
        options: q.options.map((o) => o.text),
        multiple: q.multiple,
      });
      const idx = ai?.indices?.[0];
      const chosen = idx !== undefined ? q.options[idx] : undefined;
      if (chosen) {
        answers.set(q.fieldBase, chosen.value);
        await upsertAnswer({
          questionText: q.text,
          qtype: q.qtype,
          answerText: chosen.text,
          meta: bankMeta,
          source: "ai",
        });
        fromAi++;
        continue;
      }
    }

    // c) fallback — never leave an answerable question blank. Any answer unlocks
    //    the review key, which fills the bank with the *correct* answers anyway.
    answers.set(q.fieldBase, q.options[0].value);
    fromFallback++;
  }

  // 5) Save (ticks the answers in the LMS, advances to the summary). No finish yet.
  const save = await saveAnswers(session, page, answers);

  const coverage = [`${optionQs.length} answered`];
  if (fromCache) coverage.push(`${fromCache} cached`);
  if (fromAi) coverage.push(`${fromAi} AI`);
  if (fromFallback) coverage.push(`${fromFallback} fallback`);

  // 6) Edge case: the quiz has essay / document-upload questions we can't complete.
  //    Tick the MCQ answers (done above) but DON'T submit — leave it for the user
  //    to add their document/essay and submit. The MCQ answers are saved to /answers
  //    to study either way.
  if (nonOption > 0) {
    return {
      outcome: "partial",
      detail: `${coverage.join(", ")}; ${nonOption} essay/upload left for you — ticked, NOT submitted`,
    };
  }

  // 7) Pure MCQ: verify the summary shows full coverage, then submit.
  if (save.notAnswered > 0) {
    return {
      outcome: "failed",
      detail: `coverage check: ${save.notAnswered}/${save.total} unanswered — not submitting`,
    };
  }
  const ok = await finishAttempt(session, page);
  if (!ok) return { outcome: "failed", detail: "attempt did not finish" };

  // 8) Learn the correct answers from the review.
  await learnFromReview(session, page.attemptId, bankMeta).catch(() => {});

  return { outcome: "done", detail: coverage.join(", ") };
}

/**
 * Confirm answers the LMS reveals as correct into the bank. Returns how many were
 * written. No-op (0) when the review hides correct answers.
 */
async function learnFromReview(
  session: MoodleSession,
  attemptId: number,
  bankMeta: AnswerMeta,
): Promise<number> {
  const reviewed = await getReview(session, attemptId);
  let n = 0;
  for (const r of reviewed) {
    if (!r.correctText) continue;
    await upsertAnswer({
      questionText: r.text,
      qtype: r.qtype,
      answerText: r.correctText,
      meta: bankMeta,
      source: "attempt",
      confirmed: true,
    });
    n++;
  }
  return n;
}
