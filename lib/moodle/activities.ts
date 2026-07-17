/**
 * Activity enumeration via core_courseformat_get_state.
 * Returns every course module with its completion state.
 *
 * completionstate: 0 = tracked incomplete, 1 = complete,
 *                  undefined/null = no completion tracking required.
 */
import { ajax } from "./client";
import type { MoodleSession } from "./auth";

export interface Activity {
  cmid: number;
  name: string;
  modname: string; // forum | quiz | url | page | assign | feedback | ...
  url: string | null;
  completionstate: number | null; // 0 | 1 | null
  section: number | null;
  trackable: boolean; // istrackeduser
}

export async function getActivities(
  session: MoodleSession,
  courseId: number,
): Promise<Activity[]> {
  const res = await ajax(session, "core_courseformat_get_state", {
    courseid: courseId,
  });
  if (res.error) {
    throw new Error(res.exception?.message || "Could not read course state.");
  }
  // data is a JSON *string* here.
  const state = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  const cms = (state?.cm || []) as any[];
  return cms.map((c) => ({
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
  }));
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
