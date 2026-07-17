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

/** Find a replyable root post for a discussion. */
async function rootPost(
  session: MoodleSession,
  discussionId: number,
): Promise<{ postId: number; subject: string } | null> {
  const res = await ajax(session, "mod_forum_get_discussion_posts", {
    discussionid: discussionId,
  });
  if (res.error) return null;
  const posts = (res.data?.posts || []) as any[];
  if (!posts.length) return null;
  // Root = the post with no parent; fall back to the lowest id (oldest).
  const root =
    posts.find((p) => p.parentid === null || p.parentid === 0) ||
    posts.reduce((a, b) => (a.id < b.id ? a : b));
  // Respect Moodle's own capability flag when present.
  if (root.capabilities && root.capabilities.reply === false) return null;
  return { postId: Number(root.id), subject: root.subject || "" };
}

/**
 * Post a reply into a forum so it registers as complete.
 * Returns true if the reply was accepted by Moodle.
 */
export async function replyToForum(
  session: MoodleSession,
  forumUrl: string,
  message: string,
): Promise<boolean> {
  const discussions = await discussionIds(session, forumUrl);
  for (const d of discussions) {
    const root = await rootPost(session, d);
    if (!root) continue;
    const subject = root.subject ? `Re: ${root.subject}` : "Reply";
    const res = await ajax(session, "mod_forum_add_discussion_post", {
      postid: root.postId,
      subject,
      message,
      messageformat: 1, // HTML
    });
    if (!res.error && (res.data?.postid || res.data?.post)) return true;
    // If this discussion rejected the reply, try the next one.
  }
  return false;
}
