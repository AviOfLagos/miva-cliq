/**
 * Activity enumeration via core_courseformat_get_state.
 * Returns every course module with its completion state.
 *
 * completionstate: 0 = tracked incomplete, 1 = complete, 2 = complete (passed),
 *                  3 = complete but failed the pass grade,
 *                  undefined/null = no completion tracking required.
 *
 * The completion engine reads state through `readCompletion`, which batches
 * get_state with core_completion_get_activities_completion_status in ONE
 * request. The second call tells us manual vs automatic tracking and which
 * completion rules are still unmet (view, grade, pass, post...). Every field it
 * adds is optional: if Moodle refuses or reshapes it, the engine falls back to
 * get_state alone and still works.
 */
import { ajax, ajaxBatch, type AjaxCall, type AjaxResult } from "./client";
import type { MoodleSession } from "./auth";

export interface Activity {
  cmid: number;
  name: string;
  modname: string; // forum | quiz | url | page | assign | feedback | ...
  url: string | null;
  completionstate: number | null; // 0 | 1 | 2 | 3 | null
  section: number | null;
  trackable: boolean; // istrackeduser
  /** false = hidden or locked behind an availability restriction. */
  uservisible?: boolean;
  /** From the completion-status call, when available. */
  tracking?: "manual" | "auto" | null;
  /** Names of completion rules not yet met (e.g. completionview, completionusegrade). */
  pendingRules?: string[];
}

/** A course section (topic / week) as the course page groups activities. */
export interface Section {
  number: number;
  title: string;
}

/** Moodle counts COMPLETE (1) and COMPLETE_PASS (2) as done. */
export function isComplete(state: number | null | undefined): boolean {
  return state === 1 || state === 2;
}

function parseState(res: AjaxResult): { activities: Activity[]; sections: Section[] } {
  if (res.error) {
    throw new Error(res.exception?.message || "Could not read course state.");
  }
  // data is a JSON *string* here.
  let state: any = res.data;
  if (typeof state === "string") {
    try {
      state = JSON.parse(state);
    } catch {
      throw new Error("Could not read course state (unparseable).");
    }
  }
  const cms = (Array.isArray(state?.cm) ? state.cm : []) as any[];
  const sections = ((Array.isArray(state?.section) ? state.section : []) as any[])
    .map((s) => ({
      number: Number(s.number ?? s.sectionnumber ?? s.section ?? -1),
      title: String(s.title || s.name || "").trim(),
    }))
    .filter((s) => Number.isFinite(s.number) && s.number >= 0);

  const activities: Activity[] = cms
    .filter((c) => c && Number.isFinite(Number(c.id)))
    .map((c) => ({
      cmid: Number(c.id),
      name: c.name || "",
      modname: c.module || c.modname || "",
      url: c.url || null,
      completionstate:
        c.completionstate === undefined || c.completionstate === null
          ? null
          : Number(c.completionstate),
      section: c.sectionnumber ?? null,
      trackable: !!c.istrackeduser,
      uservisible: c.uservisible === false ? false : true,
    }));

  return { activities, sections };
}

/** Activities + section titles from a single core_courseformat_get_state call. */
export async function getCourseState(
  session: MoodleSession,
  courseId: number,
): Promise<{ activities: Activity[]; sections: Section[] }> {
  const res = await ajax(session, "core_courseformat_get_state", {
    courseid: courseId,
  });
  return parseState(res);
}

export async function getActivities(
  session: MoodleSession,
  courseId: number,
): Promise<Activity[]> {
  const { activities } = await getCourseState(session, courseId);
  return activities;
}

/** Rule statuses Moodle reports as met (COMPLETION_COMPLETE / _PASS). */
const RULE_MET = new Set([1, 2]);

/**
 * Merge core_completion_get_activities_completion_status into the activities.
 * Defensive: any odd shape is ignored, leaving the get_state values untouched.
 */
function mergeCompletionStatus(acts: Activity[], res: AjaxResult | undefined): void {
  if (!res || res.error) return;
  const statuses = Array.isArray(res.data?.statuses) ? (res.data.statuses as any[]) : [];
  const byCmid = new Map<number, any>();
  for (const s of statuses) {
    if (s && Number.isFinite(Number(s.cmid))) byCmid.set(Number(s.cmid), s);
  }
  for (const a of acts) {
    const s = byCmid.get(a.cmid);
    if (!s) continue;
    const tracking = Number(s.tracking);
    a.tracking = tracking === 1 ? "manual" : tracking === 2 ? "auto" : null;
    if (s.uservisible === false) a.uservisible = false;
    if (Array.isArray(s.details)) {
      a.pendingRules = (s.details as any[])
        .filter((d) => d && typeof d.rulename === "string")
        .filter((d) => !RULE_MET.has(Number(d.rulevalue?.status)))
        .map((d) => String(d.rulename));
    }
  }
}

/**
 * The engine's one read of course state: get_state + completion status in a
 * single batched request. get_state goes first so a refusal of the status call
 * (which stops Moodle's batch) can't cost us the state itself.
 */
export async function readCompletion(
  session: MoodleSession,
  courseId: number,
): Promise<Activity[]> {
  const calls: AjaxCall[] = [
    { methodname: "core_courseformat_get_state", args: { courseid: courseId } },
  ];
  if (session.userId) {
    calls.push({
      methodname: "core_completion_get_activities_completion_status",
      args: { courseid: courseId, userid: session.userId },
    });
  }
  const [stateRes, statusRes] = await ajaxBatch(session, calls);
  const { activities } = parseState(stateRes);
  mergeCompletionStatus(activities, statusRes);
  return activities;
}

/** Re-read a single activity's completion state (for verification). */
export async function completionStateOf(
  session: MoodleSession,
  courseId: number,
  cmid: number,
): Promise<number | null> {
  const acts = await getActivities(session, courseId);
  const a = acts.find((x) => x.cmid === cmid);
  return a ? a.completionstate : null;
}
