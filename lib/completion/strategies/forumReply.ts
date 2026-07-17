import type { Strategy } from "../types";

/**
 * Forum activities. Completion may be view-based or "post a reply required".
 * We try the cheap paths honestly: manual toggle, then view the forum.
 * If the forum still isn't complete it almost certainly needs a real reply —
 * we report `failed` with that reason rather than faking success.
 *
 * Future: a dedicated strategy can fetch a discussion and POST a reply via
 * mod_forum_add_discussion_post. Left out of the MVP on purpose (needs a
 * discussion id and reply text policy).
 */
export const forumReply: Strategy = {
  name: "forumReply",
  action: "forum",
  detect: (a) => a.modname === "forum" && a.completionstate === 0,
  run: async (a, ctx) => {
    await ctx.mark(a.cmid, true).catch(() => false);
    if ((await ctx.verify(a.cmid)) === 1) return { outcome: "done" };

    if (a.url) {
      await ctx.view(a.url).catch(() => {});
      if ((await ctx.verify(a.cmid)) === 1) return { outcome: "done" };
    }
    return {
      outcome: "failed",
      detail: "forum likely needs a reply posted — do this one manually for now",
    };
  },
};
