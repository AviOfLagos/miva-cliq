import type { Strategy } from "../types";

/**
 * Catch-all. Reaches here only if no earlier strategy matched — an activity
 * shape we didn't anticipate. Never fake completion: surface it as unknown so
 * it shows up in the report and tells us a new strategy is needed.
 */
export const unknownFallback: Strategy = {
  name: "unknownFallback",
  action: "unknown",
  detect: () => true,
  run: async (a) => ({
    outcome: "failed",
    reason: "unknown-type",
    detail: `unhandled activity type "${a.modname}" — needs a new strategy`,
  }),
};
