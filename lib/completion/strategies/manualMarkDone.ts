import type { Strategy } from "../types";

/**
 * Default content completion: pages, videos, readings, urls, books, etc.
 * These are the bulk of coursework.
 *
 * Try the manual "mark as done" toggle first (confirmed working on `page`).
 * If the activity uses view-based completion, the toggle won't flip it — so we
 * fall back to GET-ing the activity URL (which server-side marks it viewed),
 * then verify. Only report `done` when the state is actually 1.
 */
export const manualMarkDone: Strategy = {
  name: "manualMarkDone",
  action: "mark",
  // Owns every tracked-incomplete activity not claimed by an earlier strategy
  // (gradedSkip / noCompletion / forumReply run before this in the registry).
  detect: (a) => a.completionstate === 0,
  run: async (a, ctx) => {
    // 1) manual toggle
    const ok = await ctx.mark(a.cmid, true).catch(() => false);
    if (ok && (await ctx.verify(a.cmid)) === 1) return { outcome: "done" };

    // 2) view-based fallback
    if (a.url) {
      await ctx.view(a.url).catch(() => {});
      if ((await ctx.verify(a.cmid)) === 1)
        return { outcome: "done", detail: "completed on view" };
    }

    // 3) last check (state may have settled)
    if ((await ctx.verify(a.cmid)) === 1) return { outcome: "done" };
    return { outcome: "failed", detail: "could not confirm completion" };
  },
};
