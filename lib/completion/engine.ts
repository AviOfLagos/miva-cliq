/**
 * Completion engine. Ties Moodle enumeration to the strategy registry.
 *
 * - plan():      dry-run preview — every activity + the action that will be taken.
 * - runCourse(): one PASS over a course, in a small fixed number of requests,
 *                inside a time budget. The client calls it again (a new
 *                /api/run request) while work remains and the last pass made
 *                progress.
 *
 * A pass:
 *   1. Read course state once (get_state + completion rules, one batched request).
 *   2. Instant decisions: already complete, policy skips, locked items.
 *   3. Bulk mark: manual toggles, 25 per request. Moodle's {status:true} reply
 *      IS the verification (the same signal its own "Mark as done" button
 *      trusts), so these are done without re-reading.
 *   4. One state read; then a view pass (concurrent GETs, no redirects, short
 *      timeout) for what is left; then one more state read. Anything Moodle now
 *      reports complete is done.
 *   5. Per-activity strategies (forum replies, quiz answering) last.
 *   6. Past the budget, no new work is started; what was not reached is
 *      returned as `remaining`. Locked items are retried on the next pass,
 *      because finishing earlier items may unlock them.
 *
 * Nothing is reported "done" unless Moodle's state says complete or the mark
 * call returned status:true. Every failure carries a reason key.
 */
import type { MoodleSession } from "../moodle/auth";
import { ajax, ajaxBatch, NOT_PROCESSED } from "../moodle/client";
import {
  readCompletion,
  completionStateOf,
  isComplete,
  type Activity,
} from "../moodle/activities";
import { viewActivity, isLmsUrl } from "../moodle/view";
import { replyToForum } from "../moodle/forum";
import { registry, strategyFor } from "./registry";
import type {
  ActionKind,
  Outcome,
  Reason,
  RunOptions,
  RunResult,
  Strategy,
  StrategyContext,
} from "./types";

export const MARK_METHOD = "core_completion_update_activity_completion_status_manually";
export const MARK_CHUNK = 25;
export const VIEW_CONCURRENCY = 4;
export const DEFAULT_BUDGET_MS = 45_000;

export interface PlannedActivity {
  cmid: number;
  name: string;
  modname: string;
  action: ActionKind;
  state: number | null;
  url: string | null; // direct Moodle link, for deep-linking into the LMS
}

export interface ProgressEvent {
  courseId: number;
  cmid: number;
  name: string;
  modname: string;
  status: Outcome;
  detail?: string;
  reason?: Reason;
  /** true = not final; a later pass will try this activity again. */
  retry?: boolean;
  index: number;
  total: number;
}

export interface CourseSummary {
  done: number;
  already: number;
  skipped: number;
  failed: number;
  total: number;
  failures: { name: string; modname: string; reason?: Reason; detail?: string }[];
  /** Work a further pass could do: activities not reached in time + locked ones. */
  remaining: number;
  /** Of `remaining`, the locked activities queued for retry. */
  locked: number;
}

/** Classify one activity for the preview (no side effects). */
function planActivity(a: Activity): ActionKind {
  if (isComplete(a.completionstate)) return "already";
  const s = strategyFor(a);
  if (s.action === "mark" && a.tracking === "auto") return "view";
  return s.action;
}

export async function plan(
  session: MoodleSession,
  courseId: number,
): Promise<PlannedActivity[]> {
  const acts = await readCompletion(session, courseId);
  return acts.map((a) => ({
    cmid: a.cmid,
    name: a.name,
    modname: a.modname,
    action: planActivity(a),
    state: a.completionstate,
    url: a.url,
  }));
}

/** Turn Moodle's unmet completion rules into a reason key + human detail. */
export function explainIncomplete(
  a: Activity,
  markError?: string,
): { reason: Reason; detail: string } {
  const rules = (a.pendingRules ?? []).map((r) => r.toLowerCase());
  const has = (re: RegExp) => rules.some((r) => re.test(r));
  if (has(/grade|pass|score/)) {
    return { reason: "needs-score", detail: "completes only on a score — do this one yourself" };
  }
  if (has(/submi/)) {
    return { reason: "needs-submission", detail: "needs a submission — do this one yourself" };
  }
  if (has(/post|discussion|repl/)) {
    return { reason: "needs-reply", detail: "needs a forum post or reply" };
  }
  if (has(/view/)) {
    return { reason: "needs-view", detail: "opening the page did not complete it" };
  }
  if (rules.length > 0) {
    return { reason: "needs-other", detail: `needs: ${rules.join(", ")}` };
  }
  if (markError) {
    return { reason: "mark-rejected", detail: `Moodle refused the mark: ${markError}` };
  }
  return { reason: "not-confirmed", detail: "Moodle did not confirm completion" };
}

function isSlow(s: Strategy, a: Activity, ctx: StrategyContext): boolean {
  return typeof s.slow === "function" ? s.slow(a, ctx) : s.slow === true;
}

async function safeRun(s: Strategy, a: Activity, ctx: StrategyContext): Promise<RunResult> {
  try {
    return await s.run(a, ctx);
  } catch (e: any) {
    return { outcome: "failed", reason: "error", detail: e?.message || "error" };
  }
}

/** Run `fn` over items, at most `limit` at a time, starting none once `go()` is false. */
async function pool<T>(
  items: T[],
  limit: number,
  go: () => boolean,
  fn: (item: T) => Promise<void>,
): Promise<T[]> {
  const notStarted: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (!go()) {
        notStarted.push(item);
        continue;
      }
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return notStarted;
}

/**
 * One pass over a course. Calls onProgress once per activity it settles.
 * Activities in options.settled are left alone; activities not reached before
 * the budget ran out get no event and are counted in `remaining`.
 */
export async function runCourse(
  session: MoodleSession,
  courseId: number,
  onProgress: (e: ProgressEvent) => void,
  options: RunOptions = {},
): Promise<CourseSummary> {
  const now = options.now ?? Date.now;
  const started = now();
  const budget = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const inBudget = () => now() - started < budget;
  const settled = new Set(options.settled ?? []);

  const acts = await readCompletion(session, courseId);
  const latest = new Map<number, Activity>(acts.map((a) => [a.cmid, a]));
  const markErrors = new Map<number, string>();

  const ctx: StrategyContext = {
    session,
    courseId,
    forumTexts: (options.forumTexts || []).filter((t) => t.trim().length > 0),
    answerQuizzes: options.answerQuizzes === true,
    courseName: options.courseName ?? null,
    async mark(cmid, completed) {
      const res = await ajax(session, MARK_METHOD, { cmid, completed });
      return !res.error && res.data?.status === true;
    },
    async view(url) {
      await viewActivity(session, url);
    },
    async verify(cmid) {
      return completionStateOf(session, courseId, cmid);
    },
    whyIncomplete(a) {
      return explainIncomplete(latest.get(a.cmid) ?? a, markErrors.get(a.cmid));
    },
    async replyToForum(forumUrl, message) {
      return replyToForum(session, forumUrl, message);
    },
  };

  const summary: CourseSummary = {
    done: 0,
    already: 0,
    skipped: 0,
    failed: 0,
    total: acts.length,
    failures: [],
    remaining: 0,
    locked: 0,
  };
  let index = 0;
  const emit = (a: Activity, r: RunResult) => {
    summary[r.outcome]++;
    if (r.outcome === "failed") {
      summary.failures.push({ name: a.name, modname: a.modname, reason: r.reason, detail: r.detail });
      if (r.retry) summary.locked++;
    }
    onProgress({
      courseId,
      cmid: a.cmid,
      name: a.name,
      modname: a.modname,
      status: r.outcome,
      detail: r.detail,
      reason: r.reason,
      retry: r.retry || undefined,
      index: ++index,
      total: acts.length,
    });
  };
  let unreached = 0;

  /**
   * Re-read state once; returns the cmids Moodle now reports complete, or null
   * if the read failed (the caller then leaves those items for the next pass
   * rather than calling them failed).
   */
  const refresh = async (): Promise<Set<number> | null> => {
    const fresh = await readCompletion(session, courseId).catch(() => null);
    if (!fresh) return null;
    const complete = new Set<number>();
    for (const a of fresh) {
      latest.set(a.cmid, a);
      if (isComplete(a.completionstate)) complete.add(a.cmid);
    }
    return complete;
  };

  type Item = { a: Activity; s: Strategy };
  const bulk: Item[] = [];
  const later: Item[] = [];

  // 1–2. Instant decisions.
  for (const a of acts) {
    if (settled.has(a.cmid)) continue;
    if (isComplete(a.completionstate)) {
      emit(a, { outcome: "already", reason: "already" });
      continue;
    }
    const s = strategyFor(a);
    if (s.bulk?.length) {
      if (a.uservisible === false) {
        emit(a, {
          outcome: "failed",
          reason: "locked",
          retry: true,
          detail: "locked until earlier items are done — will retry",
        });
      } else {
        bulk.push({ a, s });
      }
    } else if (isSlow(s, a, ctx)) {
      later.push({ a, s });
    } else {
      emit(a, await safeRun(s, a, ctx));
    }
  }

  // 3. Bulk mark. Moodle stops a batch at the first call that errors (e.g. an
  // automatic-completion activity), so calls it never processed are resubmitted.
  const marked = new Set<number>();
  const notReached = new Set<number>();
  let queue = bulk
    .filter(({ a, s }) => s.bulk!.includes("mark") && a.tracking !== "auto")
    .map(({ a }) => a.cmid);
  while (queue.length > 0) {
    if (!inBudget()) {
      queue.forEach((c) => notReached.add(c));
      break;
    }
    const chunk = queue.slice(0, MARK_CHUNK);
    queue = queue.slice(MARK_CHUNK);
    const results = await ajaxBatch(
      session,
      chunk.map((cmid) => ({ methodname: MARK_METHOD, args: { cmid, completed: true } })),
    );
    for (let i = 0; i < chunk.length; i++) {
      const r = results[i];
      if (r && !r.error && r.data?.status === true) {
        marked.add(chunk[i]);
      } else if (
        i > 0 &&
        r?.exception?.errorcode === NOT_PROCESSED &&
        results[i - 1]?.error &&
        results[i - 1]?.exception?.errorcode !== NOT_PROCESSED
      ) {
        // Moodle refused the previous call and stopped there: it never got to
        // these, so put them back at the front. (A junk or truncated response
        // is not resubmitted call by call; the state re-read decides those.)
        queue = [...chunk.slice(i), ...queue];
        break;
      } else {
        // Refused, or an odd/missing result: "not marked". The state re-read decides.
        markErrors.set(chunk[i], r?.exception?.message || "no confirmation");
      }
    }
  }
  for (const { a } of bulk) {
    if (marked.has(a.cmid)) emit(a, { outcome: "done", reason: "marked" });
  }

  // 4. Verify in bulk, view the rest, verify again.
  let left = bulk.filter(({ a }) => !marked.has(a.cmid) && !notReached.has(a.cmid));
  if (left.length > 0 && markErrors.size > 0) {
    const complete = await refresh();
    if (!complete) {
      left.forEach(({ a }) => notReached.add(a.cmid));
      left = [];
    } else {
      for (const { a } of left) {
        if (complete.has(a.cmid)) emit(a, { outcome: "done", reason: "marked" });
      }
      left = left.filter(({ a }) => !complete.has(a.cmid));
    }
  }

  const toView = left.filter(({ a, s }) => s.bulk!.includes("view") && isLmsUrl(a.url));
  let viewed = 0;
  const unviewed = await pool(toView, VIEW_CONCURRENCY, inBudget, async ({ a }) => {
    if (await viewActivity(session, a.url!)) viewed++;
  });
  unviewed.forEach(({ a }) => notReached.add(a.cmid));
  if (viewed > 0) {
    const complete = await refresh();
    if (!complete) {
      left.forEach(({ a }) => notReached.add(a.cmid));
    } else {
      for (const { a } of left) {
        if (complete.has(a.cmid) && !notReached.has(a.cmid)) {
          emit(a, { outcome: "done", reason: "viewed", detail: "completed on view" });
        }
      }
      left = left.filter(({ a }) => !complete.has(a.cmid));
    }
  }
  left = left.filter(({ a }) => !notReached.has(a.cmid));
  unreached += notReached.size;

  // Bulk leftovers: explain now, or queue the per-activity path (forum replies).
  const slowLeft: Item[] = [];
  for (const item of left) {
    const a = latest.get(item.a.cmid) ?? item.a;
    if (isSlow(item.s, a, ctx)) slowLeft.push({ a, s: item.s });
    else emit(a, await safeRun(item.s, a, ctx));
  }

  // 5. Slow strategies, last, under the budget.
  for (const { a, s } of [...slowLeft, ...later]) {
    if (!inBudget()) {
      unreached++;
      continue;
    }
    emit(a, await safeRun(s, a, ctx));
  }

  // 6. What a further pass could still do.
  summary.remaining = unreached + summary.locked;
  return summary;
}

export { registry };
