/**
 * When to call /api/run again for the same course. Pure, so it is testable and
 * the client loop in AppContext stays simple.
 *
 * A pass ends one of three ways:
 *  - `done` with summary.remaining === 0      -> finished.
 *  - `done` with remaining > 0                -> resume if the pass settled
 *                                                something new (progress).
 *  - stream ended with no `done` (the function was killed, or the network
 *    dropped)                                  -> resume; what it did report is
 *                                                kept, the next pass skips it.
 *    Two such passes in a row that report nothing -> stop.
 *  - `error` event (e.g. course unreadable)     -> stop.
 * Never more than MAX_PASSES per course.
 */
export const MAX_PASSES = 6;

export interface PassResult {
  /** Saw the `done` event. */
  gotDone: boolean;
  /** Saw an `error` event. */
  errored: boolean;
  /** summary.remaining from `done` (0 when absent). */
  remaining: number;
  /** Activities this pass settled for good (progress events without retry). */
  newlySettled: number;
}

export interface ResumeState {
  pass: number; // passes run so far for this course
  silentEnds: number; // consecutive passes that ended without `done` and settled nothing
}

export function nextPass(
  state: ResumeState,
  r: PassResult,
): { resume: boolean; state: ResumeState; why: string } {
  const silentEnds = !r.gotDone && r.newlySettled === 0 ? state.silentEnds + 1 : 0;
  const next = { pass: state.pass, silentEnds };
  if (r.errored) return { resume: false, state: next, why: "error" };
  if (state.pass >= MAX_PASSES) return { resume: false, state: next, why: "pass-cap" };
  if (!r.gotDone) {
    return silentEnds >= 2
      ? { resume: false, state: next, why: "no-response" }
      : { resume: true, state: next, why: "cut-off" };
  }
  if (r.remaining <= 0) return { resume: false, state: next, why: "finished" };
  if (r.newlySettled === 0) return { resume: false, state: next, why: "no-progress" };
  return { resume: true, state: next, why: "more-work" };
}
