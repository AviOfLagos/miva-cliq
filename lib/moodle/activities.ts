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

/** A course section (topic / week) as the course page groups activities. */
export interface Section {
  number: number;
  title: string;
}

/** Activities + section titles from a single core_courseformat_get_state call. */
export async function getCourseState(
  session: MoodleSession,
  courseId: number,
): Promise<{ activities: Activity[]; sections: Section[] }> {
  const res = await ajax(session, "core_courseformat_get_state", {
    courseid: courseId,
  });
  if (res.error) {
    throw new Error(res.exception?.message || "Could not read course state.");
  }
  // data is a JSON *string* here.
  const state = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  const cms = (state?.cm || []) as any[];
  const sections = ((state?.section || []) as any[])
    .map((s) => ({
      number: Number(s.number ?? s.sectionnumber ?? s.section ?? -1),
      title: String(s.title || s.name || "").trim(),
    }))
    .filter((s) => Number.isFinite(s.number) && s.number >= 0);

  const activities: Activity[] = cms.map((c) => ({
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

  return { activities, sections };
}

export async function getActivities(
  session: MoodleSession,
  courseId: number,
): Promise<Activity[]> {
  const { activities } = await getCourseState(session, courseId);
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
