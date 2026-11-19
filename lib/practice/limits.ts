/**
 * The per-student generation limit, as a pure decision.
 *
 * It used to be 6 calls an hour, which stops "Prepare all my courses" after
 * half a course. What it has to stop is a script hammering the LMS and the bank
 * with one login; what it has to allow is one keen student preparing their own
 * enrolled courses in a day. Sized for that: about 8 courses x 14 weeks at one
 * call a week, with room for top-ups of weeks that came up short, plus a burst cap well above the paced browser queue (one call
 * every ~20 to 40 seconds) but far below a script. The bank itself is capped
 * too: the generate route refuses a week that already has BANK_TARGET.
 */

/** Calls per rolling 24 hours: 8 courses x 14 weeks (112) plus ~40% for top-ups. */
export const GEN_PER_DAY = 160;
/** Calls per rolling 10 minutes. The paced queue makes at most ~25. */
export const GEN_PER_BURST = 40;
export const BURST_SECONDS = 10 * 60;
export const DAY_SECONDS = 24 * 60 * 60;

export type GenCounts = { burst: number; day: number };
export type GenVerdict = { ok: true } | { ok: false; reason: "burst" | "day" };

export function generationVerdict(c: GenCounts): GenVerdict {
  if (c.day >= GEN_PER_DAY) return { ok: false, reason: "day" };
  if (c.burst >= GEN_PER_BURST) return { ok: false, reason: "burst" };
  return { ok: true };
}

/** Fixed, student-readable. */
export const LIMIT_MESSAGES: Record<"burst" | "day", string> = {
  burst: "You're creating questions very fast. Take a ten-minute break, then carry on.",
  day: "You've created a lot of questions today. Practise these, and carry on tomorrow.",
};
