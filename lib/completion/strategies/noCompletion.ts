import type { Strategy } from "../types";

/**
 * Activity has no completion tracking (completionstate is null/undefined).
 * Nothing to do — skip cleanly. Common for reference `url` links.
 */
export const noCompletion: Strategy = {
  name: "noCompletion",
  action: "skip-none",
  detect: (a) => a.completionstate === null,
  run: async () => ({ outcome: "skipped", detail: "no completion required" }),
};
