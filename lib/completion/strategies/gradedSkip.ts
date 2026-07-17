import type { Strategy } from "../types";

/** Detect graded/exam names so mid- & end-semester tests are never touched. */
const GRADED_NAME = /(mid[-\s]?sem|end[-\s]?sem|final|exam|graded)/i;

/**
 * Graded tests and assignments: skip. The user takes these manually.
 * Covers quiz + assign module types, plus anything named like a graded exam.
 *
 * Policy note: weekly *ungraded* quizzes are also skipped for now (safe default).
 * A future `aiQuizAnswer` strategy can be registered BEFORE this one to attempt
 * ungraded weekly tests when the AI-answer option is enabled.
 */
export const gradedSkip: Strategy = {
  name: "gradedSkip",
  action: "skip-graded",
  detect: (a) =>
    a.modname === "quiz" ||
    a.modname === "assign" ||
    GRADED_NAME.test(a.name),
  run: async () => ({ outcome: "skipped", detail: "graded/test — left for you" }),
};
