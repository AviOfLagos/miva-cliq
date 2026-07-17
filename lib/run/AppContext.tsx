"use client";

/**
 * App-wide state, mounted once in the root layout so it outlives page
 * navigation. This is what lets a run keep going while the user reads
 * /gists or /how-it-works.
 *
 * The run is still browser-driven: we loop the planned courses and hold one
 * SSE stream per course against /api/run. Closing the tab therefore still ends
 * the run — hence the beforeunload guard below.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readSSE } from "./sse";
import { saveHistoryRecord, LAST_RUN_KEY } from "./history";
import { loadForumTexts, saveForumTexts, DEFAULT_FORUM_TEXTS } from "./prefs";
import type {
  ActivityStatus,
  HistoryCourse,
  LogLine,
  PlanCourse,
  RunCourse,
  RunMode,
  RunPhase,
  RunSummary,
  Screen,
} from "./types";

type Totals = {
  total: number;
  handled: number;
  done: number;
  skipped: number;
  failed: number;
  already: number;
};

type AppValue = {
  /* session */
  name: string;
  email: string;
  authNotice: string | null;
  signIn: (name: string, email: string) => void;
  onSessionExpired: (msg?: string) => void;
  /* navigation */
  screen: Screen;
  setScreen: (s: Screen) => void;
  /* run */
  runMode: RunMode | null;
  phase: RunPhase;
  planError: string | null;
  unmatched: string[];
  courses: RunCourse[];
  logs: LogLine[];
  activeCourseId: number | null;
  expanded: Set<number>;
  totals: Totals;
  pct: number;
  isRunning: boolean;
  startRun: (mode: RunMode) => void;
  retryPlan: () => void;
  toggleExpand: (id: number) => void;
  /* forum reply preferences */
  forumTexts: string[];
  setForumTexts: (texts: string[]) => void;
};

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside <AppProvider>");
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  /* ---- session ---- */
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("login");

  /* ---- forum reply messages (per-device, loaded once we know the user) ---- */
  const [forumTexts, setForumTextsState] = useState<string[]>(DEFAULT_FORUM_TEXTS);
  // Keep a ref so the run loop always sends the latest texts without re-creating.
  const forumTextsRef = useRef<string[]>(DEFAULT_FORUM_TEXTS);
  const setForumTexts = useCallback(
    (texts: string[]) => {
      setForumTextsState(texts);
      forumTextsRef.current = texts;
      if (email) saveForumTexts(email, texts);
    },
    [email],
  );

  /* ---- run ---- */
  const [runMode, setRunMode] = useState<RunMode | null>(null);
  const [phase, setPhase] = useState<RunPhase>("planning");
  const [planError, setPlanError] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [courses, setCourses] = useState<RunCourse[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null);

  const logId = useRef(0);
  // Monotonic token identifying the current run. Because this provider outlives
  // the run screen, a stale in-flight SSE stream would otherwise keep writing
  // into a newer run's state. Every write checks its token first.
  const runToken = useRef(0);
  const startedRef = useRef(false);
  const historySaved = useRef(false);

  const isCurrent = (token: number) => runToken.current === token;

  const pushLog = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    setLogs((prev) => {
      const next = [...prev, { id: logId.current++, text, tone }];
      return next.slice(-8);
    });
  }, []);

  const signIn = useCallback((n: string, mail: string) => {
    setAuthNotice(null);
    setName(n);
    setEmail(mail);
    const texts = loadForumTexts(mail);
    setForumTextsState(texts);
    forumTextsRef.current = texts;
    setScreen("choose");
  }, []);

  // Called by any request that returns 401 (session lapsed/missing).
  const onSessionExpired = useCallback((msg?: string) => {
    runToken.current += 1; // stop any in-flight run
    setName("");
    setRunMode(null);
    setAuthNotice(msg || "Your session expired. Please log in again.");
    setScreen("login");
  }, []);

  /* ---- overall totals ---- */
  const totals = useMemo<Totals>(() => {
    let total = 0;
    let handled = 0;
    let done = 0;
    let skipped = 0;
    let failed = 0;
    let already = 0;
    for (const c of courses) {
      for (const a of c.activities) {
        total += 1;
        if (a.status !== "pending") handled += 1;
        if (a.status === "done") done += 1;
        else if (a.status === "already") already += 1;
        else if (a.status === "skipped") skipped += 1;
        else if (a.status === "failed") failed += 1;
      }
    }
    return { total, handled, done, skipped, failed, already };
  }, [courses]);

  const pct =
    totals.total === 0 ? 0 : Math.round((totals.handled / totals.total) * 100);

  /* ---- apply a progress event to state ---- */
  const applyProgress = useCallback(
    (courseId: number, cmid: number, status: ActivityStatus, detail?: string) => {
      setCourses((prev) =>
        prev.map((c) => {
          if (c.id !== courseId) return c;
          return {
            ...c,
            activities: c.activities.map((a) =>
              a.cmid === cmid ? { ...a, status, detail } : a,
            ),
          };
        }),
      );
    },
    [],
  );

  const markCourseComplete = useCallback(
    (courseId: number, summary?: RunSummary) => {
      setCourses((prev) =>
        prev.map((c) =>
          c.id === courseId ? { ...c, complete: true, summary } : c,
        ),
      );
    },
    [],
  );

  /* ---- planning ---- */
  const doPlan = useCallback(
    async (mode: RunMode, token: number) => {
      setPhase("planning");
      setPlanError(null);
      try {
        const body =
          mode.mode === "preset"
            ? { presetId: mode.presetId }
            : { courseIds: mode.courseIds };
        const res = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (!isCurrent(token)) return;
        if (res.status === 401) {
          onSessionExpired();
          return;
        }
        if (!res.ok) {
          let msg = "Planning failed.";
          try {
            const d = await res.json();
            if (d?.error) msg = d.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        const data = await res.json();
        if (!isCurrent(token)) return;
        const planned: PlanCourse[] = data?.courses ?? [];
        setUnmatched(Array.isArray(data?.unmatched) ? data.unmatched : []);
        const mapped: RunCourse[] = planned.map((c) => ({
          id: c.id,
          fullname: c.fullname,
          complete: false,
          activities: (c.activities ?? []).map((a) => ({
            ...a,
            status: "pending" as ActivityStatus,
          })),
        }));
        if (mapped.length === 0) {
          throw new Error(
            "None of the selected courses could be found in your account.",
          );
        }
        setCourses(mapped);
        setExpanded(new Set(mapped.length ? [mapped[0].id] : []));
        pushLog(`Planned ${mapped.length} course(s).`, "good");
        setPhase("running");
      } catch (e: any) {
        if (!isCurrent(token)) return;
        setPlanError(e?.message || "Planning failed.");
        setPhase("plan-error");
      }
    },
    [pushLog, onSessionExpired],
  );

  /* ---- run sequentially ---- */
  const runAll = useCallback(
    async (token: number) => {
      for (const course of courses) {
        if (!isCurrent(token)) return;
        setActiveCourseId(course.id);
        setExpanded((prev) => new Set(prev).add(course.id));
        pushLog(`Starting: ${course.fullname}`, "info");
        try {
          const res = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              courseId: course.id,
              forumTexts: forumTextsRef.current,
            }),
          });
          if (!isCurrent(token)) return;
          if (res.status === 401) {
            onSessionExpired();
            return;
          }
          if (!res.ok || !res.body) {
            markCourseComplete(course.id);
            pushLog(`Could not start ${course.fullname}.`, "bad");
            continue;
          }
          await readSSE(res, (event, dataStr) => {
            if (!isCurrent(token)) return;
            let data: any = null;
            try {
              data = JSON.parse(dataStr);
            } catch {
              return;
            }
            if (event === "progress") {
              const status: ActivityStatus = data.status;
              applyProgress(
                data.courseId ?? course.id,
                data.cmid,
                status,
                data.detail,
              );
              const tone: LogLine["tone"] =
                status === "failed"
                  ? "bad"
                  : status === "skipped"
                    ? "warn"
                    : "good";
              const verb =
                status === "done"
                  ? "Completed"
                  : status === "already"
                    ? "Already done"
                    : status === "skipped"
                      ? "Skipped"
                      : "Failed";
              pushLog(`${verb}: ${data.name ?? "activity"}`, tone);
            } else if (event === "done") {
              markCourseComplete(
                data.courseId ?? course.id,
                data.summary as RunSummary,
              );
              pushLog(`Finished: ${course.fullname}`, "good");
            } else if (event === "error") {
              pushLog(`${course.fullname}: ${data.message || "run error"}`, "bad");
            }
          });
        } catch {
          if (!isCurrent(token)) return;
          markCourseComplete(course.id);
          pushLog(`Error running ${course.fullname}.`, "bad");
        }
      }
      if (isCurrent(token)) {
        setActiveCourseId(null);
        setPhase("finished");
      }
    },
    [courses, applyProgress, markCourseComplete, pushLog, onSessionExpired],
  );

  /* ---- entry point: called from the choose/custom screens ---- */
  const startRun = useCallback(
    (mode: RunMode) => {
      const token = ++runToken.current; // invalidates any in-flight run
      startedRef.current = false;
      historySaved.current = false;
      setRunMode(mode);
      setCourses([]);
      setLogs([]);
      setUnmatched([]);
      setPlanError(null);
      setExpanded(new Set());
      setActiveCourseId(null);
      setScreen("run");
      doPlan(mode, token);
    },
    [doPlan],
  );

  const retryPlan = useCallback(() => {
    if (runMode) startRun(runMode);
  }, [runMode, startRun]);

  // Kick off the run once we have a plan.
  useEffect(() => {
    if (phase === "running" && courses.length && !startedRef.current) {
      startedRef.current = true;
      runAll(runToken.current);
    }
  }, [phase, courses, runAll]);

  /* ---- persist run to per-device history (namespaced by user) ---- */
  useEffect(() => {
    if (phase !== "finished" || historySaved.current || !runMode) return;
    historySaved.current = true;
    const at = new Date().toISOString();
    const perCourse: HistoryCourse[] = courses.map((c) => {
      const total = c.activities.length;
      const count = (s: ActivityStatus) =>
        c.activities.filter((a) => a.status === s).length;
      const done = count("done");
      const already = count("already");
      const skipped = count("skipped");
      const failed = count("failed");
      const handled = done + already + skipped + failed;
      return {
        id: c.id,
        fullname: c.fullname,
        done,
        already,
        skipped,
        failed,
        total,
        pct: total === 0 ? 0 : Math.round((handled / total) * 100),
        failures: c.activities
          .filter((a) => a.status === "failed")
          .map((a) => ({ name: a.name, detail: a.detail })),
      };
    });
    saveHistoryRecord(email, { at, mode: runMode.mode, courses: perCourse });
    try {
      localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ at, ...totals }));
    } catch {
      /* ignore */
    }
  }, [phase, courses, totals, email, runMode]);

  /* ---- the run dies with the tab; warn before that happens ---- */
  const isRunning = phase === "running" || phase === "planning";
  const runActive = isRunning && screen === "run" && !!runMode;
  useEffect(() => {
    if (!runActive) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers require returnValue to be set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [runActive]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const value: AppValue = {
    name,
    email,
    authNotice,
    signIn,
    onSessionExpired,
    screen,
    setScreen,
    runMode,
    phase,
    planError,
    unmatched,
    courses,
    logs,
    activeCourseId,
    expanded,
    totals,
    pct,
    isRunning: runActive,
    startRun,
    retryPlan,
    toggleExpand,
    forumTexts,
    setForumTexts,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}