/**
 * Per-device user preferences (localStorage), namespaced by email — same
 * pattern as run history. Currently: custom forum reply messages, one of which
 * is picked at random per post-required forum.
 */

const FORUM_TEXTS_PREFIX = "miva-cliq-forum-texts:";
const ANSWER_QUIZZES_PREFIX = "miva-cliq-answer-quizzes:";

/** Sensible starter replies. Editable by the user; kept generic and on-topic. */
export const DEFAULT_FORUM_TEXTS: string[] = [
  "Thank you for sharing this — it really helped clarify the topic for me.",
  "Great points raised here. The examples made the concept much easier to follow.",
  "This was insightful. I have a clearer understanding of the material now.",
  "Well explained. I appreciate the breakdown and the discussion around it.",
];

function key(email: string): string {
  return FORUM_TEXTS_PREFIX + (email || "anon").toLowerCase();
}

export function loadForumTexts(email: string): string[] {
  try {
    const raw = localStorage.getItem(key(email));
    if (!raw) return DEFAULT_FORUM_TEXTS;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t) => typeof t === "string") : DEFAULT_FORUM_TEXTS;
  } catch {
    return DEFAULT_FORUM_TEXTS;
  }
}

export function saveForumTexts(email: string, texts: string[]): void {
  try {
    localStorage.setItem(key(email), JSON.stringify(texts));
  } catch {
    /* ignore quota / privacy mode */
  }
}

/**
 * Opt-in to attempting ungraded weekly quizzes during a run. Default OFF — a
 * quiz attempt is a real submission, so it never happens unless the user asks.
 */
export function loadAnswerQuizzes(email: string): boolean {
  try {
    return localStorage.getItem(ANSWER_QUIZZES_PREFIX + (email || "anon").toLowerCase()) === "1";
  } catch {
    return false;
  }
}

export function saveAnswerQuizzes(email: string, on: boolean): void {
  try {
    localStorage.setItem(
      ANSWER_QUIZZES_PREFIX + (email || "anon").toLowerCase(),
      on ? "1" : "0",
    );
  } catch {
    /* ignore quota / privacy mode */
  }
}

/**
 * The one-time "Want a study plan for your courses?" ask. Per device, not per
 * user: once answered (either way) on this phone, it never shows again.
 */
const STUDY_ASK_KEY = "miva-cliq-study-ask";

export function loadStudyAskDone(): boolean {
  try {
    return localStorage.getItem(STUDY_ASK_KEY) === "1";
  } catch {
    // No storage (privacy mode): treat as answered rather than nag on every page.
    return true;
  }
}

export function saveStudyAskDone(): void {
  try {
    localStorage.setItem(STUDY_ASK_KEY, "1");
  } catch {
    /* ignore quota / privacy mode */
  }
}

/** Clean a raw multiline textarea into a de-duped list of non-empty lines. */
export function parseForumTexts(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 20);
}
