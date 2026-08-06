/**
 * Shared client-side types for the run flow. These live outside app/page.tsx so
 * the AppProvider (mounted in the layout) and the screens can both import them
 * without a cycle.
 */

export type Screen = "login" | "choose" | "custom" | "run";

export type Preset = {
  id: string;
  label: string;
  subtitle: string;
  courses: string[];
};

export type Course = {
  id: number;
  fullname: string;
};

export type Action =
  | "mark"
  | "quiz"
  | "skip-graded"
  | "skip-none"
  | "forum"
  | "view"
  | "unknown";

export type ActivityState = string;

export type PlanActivity = {
  cmid: number;
  name: string;
  modname: string;
  action: Action;
  state: ActivityState;
  url: string | null;
};

export type ActivityStatus = "pending" | "done" | "skipped" | "failed" | "already";

export type RunActivity = PlanActivity & {
  status: ActivityStatus;
  detail?: string; // reason, esp. for failures (e.g. "forum needs a reply")
};

export type PlanCourse = {
  id: number;
  fullname: string;
  activities: PlanActivity[];
};

export type RunCourse = {
  id: number;
  fullname: string;
  activities: RunActivity[];
  complete: boolean;
  summary?: RunSummary;
};

export type RunSummary = {
  done: number;
  skipped: number;
  failed: number;
  already: number;
  total: number;
};

export type RunMode =
  | { mode: "preset"; presetId: string }
  | { mode: "custom"; courseIds: number[] };

export type LogLine = {
  id: number;
  text: string;
  tone: "info" | "good" | "warn" | "bad";
};

export type RunPhase = "planning" | "plan-error" | "running" | "finished";

/* ---- per-device run history (localStorage, namespaced by user email) ---- */

export type HistoryCourse = {
  id: number;
  fullname: string;
  done: number;
  already: number;
  skipped: number;
  failed: number;
  total: number;
  pct: number;
  failures: { name: string; detail?: string }[];
};

export type HistoryRecord = {
  at: string; // ISO timestamp
  mode: "preset" | "custom";
  courses: HistoryCourse[];
};
