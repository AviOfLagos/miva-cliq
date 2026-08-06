/**
 * Completion-strategy registry — ORDER MATTERS. First `detect()` match wins.
 *
 * To support a new completion method (LMS changes, new activity type, AI quiz
 * answering, real forum replies): write one strategy file in ./strategies and
 * insert it here at the right priority. No engine changes needed.
 */
import type { Strategy } from "./types";
import { aiQuizAnswer } from "./strategies/aiQuizAnswer";
import { gradedSkip } from "./strategies/gradedSkip";
import { noCompletion } from "./strategies/noCompletion";
import { forumReply } from "./strategies/forumReply";
import { manualMarkDone } from "./strategies/manualMarkDone";
import { unknownFallback } from "./strategies/unknownFallback";

export const registry: Strategy[] = [
  aiQuizAnswer, // 1. quizzes: attempt when opted-in (ungraded-only), else skip
  gradedSkip, // 2. never touch graded tests/assignments
  noCompletion, // 3. nothing to do (untracked)
  forumReply, // 4. forums (may need a reply)
  manualMarkDone, // 5. everything else content: mark / view
  unknownFallback, // 6. safety net — reports, never fakes
];

/** Pick the strategy that owns an activity (used by both plan and run). */
export function strategyFor(
  a: { completionstate: number | null },
  all: Strategy[] = registry,
): Strategy {
  // already-complete is decided by the engine, not a strategy.
  return all.find((s) => s.detect(a as any)) || unknownFallback;
}
