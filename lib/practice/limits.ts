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

/* -------------------------------------------------------- source plan --- */

/** Saved notes older than this are rebuilt by the next material-based generation from an enrolled student. */
export const NOTES_REFRESH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReservationResult = "reserved" | "limited" | "unavailable";

export type SourcePlan =
  | { kind: "limited" }
  | { kind: "notes" }
  /** Read the LMS; if that yields nothing (or the student is not enrolled), use `fallback`. */
  | { kind: "material"; fallback: "notes" | "outline" }
  | { kind: "outline" };

/**
 * What one generation call is written from. The rate-limit slot is reserved
 * before this is asked: no slot, no call. If the reservation could not be made
 * (no database, or the query failed) the LMS is never read, so an outage of
 * the limiter cannot be used to hammer the LMS; notes or titles still work.
 * Fresh notes always win (no LMS access at all); stale notes are rebuilt from
 * the material when the student can read it.
 */
export function planSource(i: {
  reservation: ReservationResult;
  notesUpdatedAt: number | null;
  canReadLms: boolean;
  now: number;
}): SourcePlan {
  if (i.reservation === "limited") return { kind: "limited" };
  const lms = i.reservation === "reserved" && i.canReadLms;
  if (i.notesUpdatedAt !== null) {
    const stale = i.now - i.notesUpdatedAt > NOTES_REFRESH_DAYS * DAY_MS;
    return stale && lms ? { kind: "material", fallback: "notes" } : { kind: "notes" };
  }
  return lms ? { kind: "material", fallback: "outline" } : { kind: "outline" };
}
