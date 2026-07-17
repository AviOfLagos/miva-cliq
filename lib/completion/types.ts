import type { MoodleSession } from "../moodle/auth";
import type { Activity } from "../moodle/activities";

/** What the plan-preview badge shows for an activity. */
export type ActionKind =
  | "mark" // manual "mark as done"
  | "view" // completes on view (GET the activity)
  | "forum" // needs a forum interaction
  | "skip-graded" // graded test/assignment -> user does it
  | "skip-none" // no completion tracking -> nothing to do
  | "already" // already complete
  | "unknown"; // unrecognised -> surfaced, never faked

/** Outcome of actually running a strategy against an activity. */
export type Outcome = "done" | "already" | "skipped" | "failed";

/** Helpers a strategy uses to act on Moodle, injected by the engine. */
export interface StrategyContext {
  session: MoodleSession;
  courseId: number;
  /** Fire the manual completion toggle. */
  mark(cmid: number, completed: boolean): Promise<boolean>;
  /** GET an activity URL to trigger view-based completion. */
  view(url: string): Promise<void>;
  /** Re-read an activity's completion state (null = untracked). */
  verify(cmid: number): Promise<number | null>;
  /** User-supplied forum reply messages; one is picked at random per forum. */
  forumTexts: string[];
  /** Post a reply into a forum (returns true if Moodle accepted it). */
  replyToForum(forumUrl: string, message: string): Promise<boolean>;
}

/** Options threaded from the request into the engine and strategy context. */
export interface RunOptions {
  /** Reply messages a user provided for post-required forums. */
  forumTexts?: string[];
}

export interface RunResult {
  outcome: Outcome;
  detail?: string;
}

/** A pluggable completion strategy. Add one file, register it — no engine change. */
export interface Strategy {
  name: string;
  /** Badge shown in the plan preview when this strategy owns the activity. */
  action: ActionKind;
  /** Does this strategy handle the given activity? First match in the registry wins. */
  detect(a: Activity): boolean;
  /** Complete (or deliberately skip) the activity and report honestly. */
  run(a: Activity, ctx: StrategyContext): Promise<RunResult>;
}
