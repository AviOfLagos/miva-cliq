import type { MoodleSession } from "../moodle/auth";
import type { Activity } from "../moodle/activities";

/** What the plan-preview badge shows for an activity. */
export type ActionKind =
  | "mark" // manual "mark as done"
  | "view" // completes on view (GET the activity)
  | "forum" // needs a forum interaction
  | "quiz" // ungraded quiz -> AI/answer-bank attempt (opt-in)
  | "skip-graded" // graded test/assignment -> user does it
  | "skip-none" // no completion tracking -> nothing to do
  | "already" // already complete
  | "unknown"; // unrecognised -> surfaced, never faked

/** Outcome of actually running a strategy against an activity. */
export type Outcome = "done" | "already" | "skipped" | "failed";

/**
 * Short machine key saying HOW something finished or WHY it did not. Carried on
 * every progress event and counted (by activity type, no user identity) in
 * completion_outcomes. Known values:
 *   done:    marked | viewed | replied | quiz
 *   skipped: graded | no-tracking | quiz-off | quiz-graded
 *   failed:  locked | needs-score | needs-view | needs-reply | needs-submission
 *            | needs-other | mark-rejected | not-confirmed | unknown-type | error
 * Free-form keys are allowed; telemetry normalises them.
 */
export type Reason = string;

/** Cheap steps the engine performs in bulk for every activity a strategy owns. */
export type BulkStep =
  | "mark" // batched core_completion_update_activity_completion_status_manually
  | "view"; // GET the activity page (no redirects followed, short timeout)

/** Helpers a strategy uses to act on Moodle, injected by the engine. */
export interface StrategyContext {
  session: MoodleSession;
  courseId: number;
  /** Fire the manual completion toggle for one activity. */
  mark(cmid: number, completed: boolean): Promise<boolean>;
  /** GET an LMS activity URL to trigger view-based completion. */
  view(url: string): Promise<void>;
  /** Re-read an activity's completion state (null = untracked). One request. */
  verify(cmid: number): Promise<number | null>;
  /** Why a bulk-handled activity is still incomplete, from Moodle's own rules. */
  whyIncomplete(a: Activity): { reason: Reason; detail: string };
  /** User-supplied forum reply messages; one is picked at random per forum. */
  forumTexts: string[];
  /** Opt-in: attempt ungraded quizzes via AI/answer-bank. Off by default. */
  answerQuizzes: boolean;
  /** Course display name, for deriving the answer-bank course_code metadata. */
  courseName: string | null;
  /** Post a reply into a forum. See ReplyResult for the outcomes. */
  replyToForum(
    forumUrl: string,
    message: string,
  ): Promise<"posted" | "already-posted" | "failed">;
}

/** Options threaded from the request into the engine and strategy context. */
export interface RunOptions {
  /** Reply messages a user provided for post-required forums. */
  forumTexts?: string[];
  /** Opt-in: attempt ungraded quizzes. */
  answerQuizzes?: boolean;
  /** Course display name (client knows it; used for answer-bank metadata). */
  courseName?: string | null;
  /**
   * cmids an earlier pass of this run already reported with a final outcome.
   * They are left alone (no event, no request) so a resumed pass only spends
   * time on what is left.
   */
  settled?: number[];
  /** Stop taking new work after this many ms. Default 45 000. */
  budgetMs?: number;
  /** Clock, injectable for tests. Default Date.now. */
  now?: () => number;
}

export interface RunResult {
  outcome: Outcome;
  detail?: string;
  reason?: Reason;
  /** Worth trying again on a later pass (e.g. locked behind earlier items). */
  retry?: boolean;
}

/**
 * A pluggable completion strategy. Add one file, register it — no engine change.
 *
 * Cost model (how the engine keeps a course inside one request's time budget):
 *  - `bulk` steps are done by the engine for ALL activities a strategy owns at
 *    once (25 marks per request, then concurrent page views), verified by one
 *    course-state read each. Activities complete after that never reach run().
 *  - run() is then called for each activity still incomplete. Strategies that
 *    make their own requests per activity set `slow`; they run last and
 *    stop when the time budget is spent (the client resumes in a new request).
 *  - Without `slow`, run() must not make requests (it just decides/explains).
 */
export interface Strategy {
  name: string;
  /** Badge shown in the plan preview when this strategy owns the activity. */
  action: ActionKind;
  /** Does this strategy handle the given activity? First match in the registry wins. */
  detect(a: Activity): boolean;
  bulk?: BulkStep[];
  /** May depend on the run options (e.g. quiz answering off = instant skip). */
  slow?: boolean | ((a: Activity, ctx: StrategyContext) => boolean);
  /** Complete (or deliberately skip) the activity and report honestly. */
  run(a: Activity, ctx: StrategyContext): Promise<RunResult>;
}
