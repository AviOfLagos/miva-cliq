import type { Strategy } from "../types";

/**
 * Forum activities. Completion may be view-based or "post a reply required".
 *
 * Order of attempts:
 *   1. Manual "mark as done" toggle (cheap).
 *   2. View the forum (satisfies view-based completion).
 *   3. If the user supplied reply texts, post a randomly-chosen one into an
 *      existing discussion (satisfies post-required completion) and verify.
 *
 * Without reply texts, or if posting is not possible (e.g. Announcements, where
 * students can't post), we report `failed` honestly rather than faking it.
 */
export const forumReply: Strategy = {
  name: "forumReply",
  action: "forum",
  detect: (a) => a.modname === "forum" && a.completionstate === 0,
  run: async (a, ctx) => {
    // 1. cheap paths first
    await ctx.mark(a.cmid, true).catch(() => false);
    if ((await ctx.verify(a.cmid)) === 1) return { outcome: "done" };
    if (a.url) {
      await ctx.view(a.url).catch(() => {});
      if ((await ctx.verify(a.cmid)) === 1) return { outcome: "done" };
    }

    // 2. post a reply, if the user gave us texts to use
    if (a.url && ctx.forumTexts.length > 0) {
      const text = ctx.forumTexts[Math.floor(Math.random() * ctx.forumTexts.length)];
      const posted = await ctx.replyToForum(a.url, text).catch(() => false);
      if (posted && (await ctx.verify(a.cmid)) === 1) {
        return { outcome: "done", detail: "posted a reply" };
      }
      if (posted) {
        // Reply went through but completion didn't flip — surface honestly.
        return { outcome: "failed", detail: "replied, but completion didn't register" };
      }
      return {
        outcome: "failed",
        detail: "couldn't post a reply here (may be announcements-only)",
      };
    }

    return {
      outcome: "failed",
      detail:
        ctx.forumTexts.length === 0
          ? "needs a forum reply — add reply messages to auto-complete these"
          : "forum likely needs a reply posted — do this one manually",
    };
  },
};
