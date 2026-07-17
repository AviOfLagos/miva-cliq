/**
 * Completion engine. Ties Moodle enumeration to the strategy registry.
 *
 * - plan():  dry-run preview — every activity + the action that will be taken.
 * - runCourse(): execute strategies, verifying each completion, streaming progress.
 *
 * Verification: the manual-completion call returns Moodle's own {status:true}
 * confirmation (the same signal the "Mark as done" button trusts) — that IS the
 * verification for manual completions. View-based completions are confirmed by
 * re-reading the activity state. Nothing is ever reported "done" on a guess.
 */
import type { MoodleSession } from "../moodle/auth";
import { LMS, cookieHeader } from "../moodle/auth";
import { ajax } from "../moodle/client";
import { getActivities, completionStateOf, type Activity } from "../moodle/activities";
import { registry, strategyFor } from "./registry";
import type { ActionKind, Outcome, StrategyContext } from "./types";

export interface PlannedActivity {
  cmid: number;
  name: string;
  modname: string;
  action: ActionKind;
  state: number | null;
}

export interface ProgressEvent {
  courseId: number;
  cmid: number;
  name: string;
  modname: string;
  status: Outcome;
  detail?: string;
  index: number;
  total: number;
}

export interface CourseSummary {
  done: number;
  already: number;
  skipped: number;
  failed: number;
  total: number;
  failures: { name: string; detail?: string }[];
}

/** Classify one activity for the preview (no side effects). */
function planActivity(a: Activity): ActionKind {
  if (a.completionstate === 1) return "already";
  return strategyFor(a).action;
}

export async function plan(
  session: MoodleSession,
  courseId: number,
): Promise<PlannedActivity[]> {
  const acts = await getActivities(session, courseId);
  return acts.map((a) => ({
    cmid: a.cmid,
    name: a.name,
    modname: a.modname,
    action: planActivity(a),
    state: a.completionstate,
  }));
}

function makeContext(session: MoodleSession, courseId: number): StrategyContext {
  return {
    session,
    courseId,
    async mark(cmid, completed) {
      const res = await ajax(
        session,
        "core_completion_update_activity_completion_status_manually",
        { cmid, completed },
      );
      return !res.error && res.data?.status === true;
    },
    async view(url) {
      await fetch(url, { headers: { cookie: cookieHeader(session.cookies) } });
    },
    async verify(cmid) {
      return completionStateOf(session, courseId, cmid);
    },
  };
}

/**
 * Run every activity in a course. Calls onProgress after each one.
 * Returns a reconciled summary.
 */
export async function runCourse(
  session: MoodleSession,
  courseId: number,
  onProgress: (e: ProgressEvent) => void,
): Promise<CourseSummary> {
  const acts = await getActivities(session, courseId);
  const ctx = makeContext(session, courseId);
  const summary: CourseSummary = {
    done: 0,
    already: 0,
    skipped: 0,
    failed: 0,
    total: acts.length,
    failures: [],
  };

  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    let status: Outcome;
    let detail: string | undefined;

    if (a.completionstate === 1) {
      status = "already";
    } else {
      const strategy = strategyFor(a);
      try {
        const r = await strategy.run(a, ctx);
        status = r.outcome;
        detail = r.detail;
      } catch (e: any) {
        status = "failed";
        detail = e?.message || "error";
      }
    }

    summary[status]++;
    if (status === "failed") summary.failures.push({ name: a.name, detail });

    onProgress({
      courseId,
      cmid: a.cmid,
      name: a.name,
      modname: a.modname,
      status,
      detail,
      index: i + 1,
      total: acts.length,
    });
  }

  return summary;
}

export { registry };
