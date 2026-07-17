/**
 * Forum posting. "Post-required" forums only complete once the student adds a
 * reply. New discussions are blocked via the API (mod_forum_add_discussion is
 * not in the AJAX allow-list), but replying is allowed
 * (mod_forum_add_discussion_post), so we reply to an existing discussion's
 * root post.
 *
 * Flow: forum view page -> discussion ids -> get_discussion_posts -> root post
 * (parentid === null) -> add_discussion_post.
 */
import { ajax } from "./client";
import { LMS, cookieHeader, type MoodleSession } from "./auth";

/** Read discussion ids off the forum view page (no AJAX method exposes them). */
async function discussionIds(
  session: MoodleSession,
  forumUrl: string,
): Promise<number[]> {
  const res = await fetch(forumUrl, {
    headers: { cookie: cookieHeader(session.cookies) },
  });
  const html = await res.text();
  const ids = [...html.matchAll(/discuss\.php\?d=(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  return [...new Set(ids)];
}

export type ReplyResult = "posted" | "already-posted" | "failed";

/** Cap how many discussions we'll inspect on a busy forum. */
const MAX_DISCUSSIONS = 8;

/**
 * Post a reply into a forum so it registers as complete.
 *
 * - "posted"         a reply was accepted by Moodle.
 * - "already-posted" the user already has a reply in this forum, so we DON'T
 *                    post again (avoids duplicate replies on re-runs).
 * - "failed"         no discussion could be replied to (e.g. Announcements, or
 *                    a forum that requires starting a new topic — which the API
 *                    blocks).
 */
export async function replyToForum(
  session: MoodleSession,
  forumUrl: string,
  message: string,
): Promise<ReplyResult> {
  const discussions = (await discussionIds(session, forumUrl)).slice(
    0,
    MAX_DISCUSSIONS,
  );
  for (const d of discussions) {
    const res = await ajax(session, "mod_forum_get_discussion_posts", {
      discussionid: d,
    });
    if (res.error) continue;
    const posts = (res.data?.posts || []) as any[];
    if (!posts.length) continue;

    // Never double-post: if we already replied in this discussion, stop.
    if (posts.some((p) => Number(p.author?.id) === session.userId)) {
      return "already-posted";
    }

    const root =
      posts.find((p) => p.parentid === null || p.parentid === 0) ||
      posts.reduce((a, b) => (a.id < b.id ? a : b));
    if (root.capabilities && root.capabilities.reply === false) continue;

    const subject = root.subject ? `Re: ${root.subject}` : "Reply";
    const r = await ajax(session, "mod_forum_add_discussion_post", {
      postid: Number(root.id),
      subject,
      message,
      messageformat: 1, // HTML
    });
    if (!r.error && (r.data?.postid || r.data?.post)) return "posted";
    // Otherwise try the next discussion.
  }
  return "failed";
}
