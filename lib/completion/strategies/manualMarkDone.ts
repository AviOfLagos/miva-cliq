import type { Strategy } from "../types";

/**
 * Default content completion: pages, videos, readings, urls, books, etc.
 * These are the bulk of coursework.
 *
 * All the work happens in the engine's bulk steps: the manual "mark as done"
 * toggle (batched, trusted when Moodle returns status:true), then a view of the
 * page for view-based completion, each confirmed by one course-state read.
 * run() is only reached for what is STILL incomplete after that, and reports
 * Moodle's own reason (needs a score, needs a submission...). Never fakes it.
 */
export const manualMarkDone: Strategy = {
  name: "manualMarkDone",
  action: "mark",
  // Owns every tracked-incomplete activity not claimed by an earlier strategy
  // (gradedSkip / noCompletion / forumReply run before this in the registry).
  // State 3 = "complete, failed the pass grade": still incomplete for the student.
  detect: (a) => a.completionstate === 0 || a.completionstate === 3,
  bulk: ["mark", "view"],
  run: async (a, ctx) => ({ outcome: "failed", ...ctx.whyIncomplete(a) }),
};
