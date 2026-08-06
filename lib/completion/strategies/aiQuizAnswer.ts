import type { Strategy } from "../types";
import { answerQuiz } from "../../quiz/run";
import { codeOf } from "../../moodle/courses";

/**
 * Ungraded-quiz answering (opt-in). Registered BEFORE gradedSkip so it claims
 * quizzes first, but it only acts when the user turned the toggle on for this run.
 *
 * Two guards keep this on the right side of the line:
 *   1. toggle OFF  -> behaves exactly like gradedSkip (leaves the quiz alone).
 *   2. toggle ON   -> answerQuiz() still refuses any quiz that counts toward the
 *      grade; only genuinely ungraded quizzes are attempted, MCQ-only.
 */
export const aiQuizAnswer: Strategy = {
  name: "aiQuizAnswer",
  action: "quiz",
  detect: (a) => a.modname === "quiz",
  run: async (a, ctx) => {
    if (!ctx.answerQuizzes) {
      return { outcome: "skipped", detail: "quiz — enable weekly quizzes to attempt" };
    }
    const year = new Date().getFullYear();
    const res = await answerQuiz(ctx.session, ctx.courseId, a, {
      courseCode: ctx.courseName ? codeOf(ctx.courseName) : null,
      year,
    });
    // "partial" (some blank / non-MCQ present) still counts as done for the run
    // summary; the detail carries the breakdown.
    if (res.outcome === "partial") {
      return { outcome: "done", detail: res.detail };
    }
    return { outcome: res.outcome, detail: res.detail };
  },
};
