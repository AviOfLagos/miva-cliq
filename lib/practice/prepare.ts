/**
 * The "Prepare this course" / "Prepare all my courses" queue, as pure rules.
 * The browser runs it: one generate request per step, one step at a time, a
 * pause between calls, so no single request runs long and the student's free
 * Gemini quota is spent evenly. Each week gets ONE call, which asks for enough
 * questions to reach the target; a week that falls short after validation
 * shows "Started" and the next press tops it up. Re-pressing the button rebuilds the queue from
 * fresh counts, so weeks that are already ready are skipped: that is what makes
 * it resumable.
 */
import { BANK_TARGET } from "./targets.ts";

/** Pause between Gemini calls. The free tier allows only a handful of requests a minute. */
export const PAUSE_MS = 6_000;
/** Stop after this many failed calls in a row: something is wrong that retrying will not fix. */
export const MAX_FAILURES_IN_ROW = 3;

export type PrepWeek = { courseCode: string; courseId: number | null; week: number; count: number | null };

/** Weeks below the target, in the order given (course order, then week order). Unknown counts are skipped. */
export function weeksToPrepare<W extends PrepWeek>(weeks: W[], target: number = BANK_TARGET): W[] {
  return weeks.filter((w) => typeof w.count === "number" && w.count < target);
}

export type Outcome =
  | { kind: "added"; bankSize: number }
  | { kind: "full"; bankSize: number }
  | { kind: "quota" }
  | { kind: "invalid_key" }
  | { kind: "limited" }
  | { kind: "logged_out" }
  | { kind: "unavailable" }
  | { kind: "failed" };

/** Map a /api/practice/generate response to an outcome. */
export function outcomeOf(status: number, json: any): Outcome {
  const size = Number(json?.bankSize);
  if (status >= 200 && status < 300) return { kind: "added", bankSize: Number.isFinite(size) ? size : 0 };
  if (status === 409 && json?.full) return { kind: "full", bankSize: Number.isFinite(size) ? size : BANK_TARGET };
  if (status === 401) return { kind: "logged_out" };
  if (status === 503 && json?.unavailable) return { kind: "unavailable" };
  if (json?.keyError === "quota") return { kind: "quota" };
  if (json?.keyError === "invalid_key") return { kind: "invalid_key" };
  if (status === 429) return { kind: "limited" };
  return { kind: "failed" };
}

export type Step =
  /** Move to the next week in the queue. */
  | { action: "next"; done: boolean }
  /** Stop the whole run and show `message`. */
  | { action: "stop"; message: string; fixKey?: boolean };

export const STOP_MESSAGES = {
  quota:
    "Your Gemini key has reached Google's free limit for now. Come back in a while and press Prepare again: weeks that are ready are skipped.",
  invalid_key: "Google didn't accept your Gemini key. Check it on the key page, then press Prepare again.",
  limited:
    "You've prepared a lot today. Come back tomorrow and press Prepare again: weeks that are ready are skipped.",
  logged_out: "You've been logged out. Log in again, then press Prepare again to carry on.",
  unavailable: "Practice isn't switched on yet, so nothing can be prepared right now.",
  failures: "Several weeks in a row couldn't be prepared. Try again in a few minutes: finished weeks are kept.",
} as const;

/**
 * What to do after a week's one call. `failuresInRow` includes this call if it
 * failed. A week that came up short moves on as "Started" (done: false).
 */
export function decide(outcome: Outcome, failuresInRow: number, target: number = BANK_TARGET): Step {
  switch (outcome.kind) {
    case "added":
      return { action: "next", done: outcome.bankSize >= target };
    case "full":
      return { action: "next", done: true };
    case "quota":
      return { action: "stop", message: STOP_MESSAGES.quota };
    case "invalid_key":
      return { action: "stop", message: STOP_MESSAGES.invalid_key, fixKey: true };
    case "limited":
      return { action: "stop", message: STOP_MESSAGES.limited };
    case "logged_out":
      return { action: "stop", message: STOP_MESSAGES.logged_out };
    case "unavailable":
      return { action: "stop", message: STOP_MESSAGES.unavailable };
    case "failed":
      if (failuresInRow >= MAX_FAILURES_IN_ROW) return { action: "stop", message: STOP_MESSAGES.failures };
      return { action: "next", done: false };
  }
}
