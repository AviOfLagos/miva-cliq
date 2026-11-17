import type { Strategy } from "../types";
import { isComplete } from "../../moodle/activities";

/**
 * Forum activities. Completion may be view-based or "post a reply required".
 *
 * Order of attempts:
 *   1. (engine, bulk) manual "mark as done" toggle, then a view of the forum.
 *   2. (run, per forum, last) if the user supplied reply texts, post a
 *      randomly-chosen one into an existing discussion (satisfies
 *      post-required completion) and verify.
 *
 * Without reply texts, or if posting is not possible (e.g. Announcements, where
 * students can't post), we report `failed` honestly rather than faking it.
 */
export const forumReply: Strategy = {
  name: "forumReply",
  action: "forum",
  detect: (a) => a.modname === "forum" && a.completionstate === 0,
  bulk: ["mark", "view"],
  // Posting is per forum; without reply texts run() just explains, instantly.
  slow: (_a, ctx) => ctx.forumTexts.length > 0,
  run: async (a, ctx) => {
    if (a.url && ctx.forumTexts.length > 0) {
      const text = ctx.forumTexts[Math.floor(Math.random() * ctx.forumTexts.length)];
      const result = await ctx.replyToForum(a.url, text).catch(
        () => "failed" as const,
      );

      if (result === "posted") {
        if (isComplete(await ctx.verify(a.cmid))) {
          return { outcome: "done", reason: "replied", detail: "posted a reply" };
        }
        return {
          outcome: "failed",
          reason: "needs-other",
          detail: "replied, but completion didn't register",
        };
      }

      if (result === "already-posted") {
        // Don't spam a second reply. Maybe it completed since; re-check.
        if (isComplete(await ctx.verify(a.cmid))) {
          return { outcome: "done", reason: "replied" };
        }
        return {
          outcome: "failed",
          reason: "needs-other",
          detail: "you've already replied here — completion may need something else",
        };
      }

      return {
        outcome: "failed",
        reason: "needs-reply",
        detail: "couldn't post a reply here (may be announcements-only)",
      };
    }

    return {
      outcome: "failed",
      reason: "needs-reply",
      detail:
        ctx.forumTexts.length === 0
          ? "needs a forum reply — add reply messages to auto-complete these"
          : "forum likely needs a reply posted — do this one manually",
    };
  },
};
