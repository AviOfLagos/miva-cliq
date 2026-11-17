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
import { nextPass, type PassResult, type ResumeState } from "./resume";
import { saveHistoryRecord, LAST_RUN_KEY } from "./history";
import {
  loadForumTexts,
  saveForumTexts,
  DEFAULT_FORUM_TEXTS,
  loadAnswerQuizzes,
  saveAnswerQuizzes,
} from "./prefs";
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
  /* opt-in: attempt ungraded weekly quizzes */
  answerQuizzes: boolean;
  setAnswerQuizzes: (on: boolean) => void;
  /* community identity (Gists/Events) */
  authed: boolean; // has a valid Miva session cookie (can post)
  username: string | null; // chosen handle, null = none yet
  setUsername: (u: string | null) => void;
  refreshMe: () => void;
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

  /* ---- community identity (independent of the /cliq login screen) ---- */
  const [authed, setAuthed] = useState(false);
  const [username, setUsernameState] = useState<string | null>(null);
  // Ask the server who we are: 200 => logged in (cookie valid), body carries the
  // handle (or null). 401 => not logged in. Runs on mount so a direct visit to
  // /gists still knows the viewer's state without going through /cliq.
  const refreshMe = useCallback(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d === "object") {
          setAuthed(true);
          setUsernameState(d.username ?? null);
        } else {
          setAuthed(false);
          setUsernameState(null);
        }
      })
      .catch(() => {
        /* leave state as-is on a network blip */
      });
  }, []);
  const setUsername = useCallback((u: string | null) => setUsernameState(u), []);

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

  /* ---- ungraded-quiz opt-in (per-device, default off) ---- */
  const [answerQuizzes, setAnswerQuizzesState] = useState<boolean>(false);
  const answerQuizzesRef = useRef<boolean>(false);
  const setAnswerQuizzes = useCallback(
    (on: boolean) => {
      setAnswerQuizzesState(on);
      answerQuizzesRef.current = on;
      if (email) saveAnswerQuizzes(email, on);
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

  const signIn = useCallback(
    (n: string, mail: string) => {
      setAuthNotice(null);
      setName(n);
      setEmail(mail);
      const texts = loadForumTexts(mail);
      setForumTextsState(texts);
      forumTextsRef.current = texts;
      const aq = loadAnswerQuizzes(mail);
      setAnswerQuizzesState(aq);
      answerQuizzesRef.current = aq;
      setScreen("choose");
      // Just authenticated — pull the community handle (usually null at first).
      refreshMe();
    },
    [refreshMe],
  );

  // Learn the viewer's community identity on first mount (cookie may already
  // exist from a prior /cliq login).
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // Called by any request that returns 401 (session lapsed/missing).
  const onSessionExpired = useCallback((msg?: string) => {
    runToken.current += 1; // stop any in-flight run
    setName("");
    setRunMode(null);
    setAuthed(false);
    setUsernameState(null);
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

  /* ---- run sequentially; each course may take several passes ---- */
  const runAll = useCallback(
    async (token: number) => {
      for (const course of courses) {
        if (!isCurrent(token)) return;
        setActiveCourseId(course.id);
        setExpanded((prev) => new Set(prev).add(course.id));
        pushLog(`Starting: ${course.fullname}`, "info");

        // Local mirror of this course's statuses (React state is async), so the
        // loop can pass `settled` and build the summary across passes.
        const statuses = new Map<number, ActivityStatus>(
          course.activities.map((a) => [a.cmid, a.status]),
        );
        const settled = new Set<number>();
        let resume: ResumeState = { pass: 0, silentEnds: 0 };

        // eslint-disable-next-line no-constant-condition
        while (true) {
          resume = { ...resume, pass: resume.pass + 1 };
          if (resume.pass > 1) {
            pushLog(`${course.fullname}: continuing (pass ${resume.pass})`, "info");
          }
          const pass: PassResult = {
            gotDone: false,
            errored: false,
            remaining: 0,
            newlySettled: 0,
          };
          try {
            const res = await fetch("/api/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                courseId: course.id,
                courseName: course.fullname,
                forumTexts: forumTextsRef.current,
                answerQuizzes: answerQuizzesRef.current,
                settled: Array.from(settled),
              }),
            });
            if (!isCurrent(token)) return;
            if (res.status === 401) {
              onSessionExpired();
              return;
            }
            if (!res.ok || !res.body) {
              pushLog(`Could not start ${course.fullname}.`, "bad");
              pass.errored = true;
            } else {
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
                  applyProgress(course.id, data.cmid, status, data.detail);
                  statuses.set(data.cmid, status);
                  if (!data.retry && !settled.has(data.cmid)) {
                    settled.add(data.cmid);
                    pass.newlySettled++;
                  }
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
                  pass.gotDone = true;
                  pass.remaining = Number(data?.summary?.remaining) || 0;
                } else if (event === "error") {
                  pass.errored = true;
                  pushLog(`${course.fullname}: ${data.message || "run error"}`, "bad");
                }
              });
            }
          } catch {
            if (!isCurrent(token)) return;
            // Network drop or the function was killed mid-stream: treated as a
            // cut-off pass below, so it is retried.
          }
          if (!isCurrent(token)) return;

          const step = nextPass(resume, pass);
          resume = step.state;
          if (!step.resume) {
            if (step.why === "pass-cap" || step.why === "no-response") {
              pushLog(`${course.fullname}: stopped after ${resume.pass} pass(es).`, "warn");
            }
            break;
          }
        }

        // Anything never reached is reported, not left spinning.
        for (const [cmid, st] of Array.from(statuses)) {
          if (st === "pending") {
            applyProgress(course.id, cmid, "failed", "not reached — run this course again");
            statuses.set(cmid, "failed");
          }
        }
        const count = (st: ActivityStatus) =>
          Array.from(statuses.values()).filter((x) => x === st).length;
        const summary: RunSummary = {
          done: count("done"),
          already: count("already"),
          skipped: count("skipped"),
          failed: count("failed"),
          total: statuses.size,
        };
        markCourseComplete(course.id, summary);
        pushLog(`Finished: ${course.fullname}`, summary.failed > 0 ? "warn" : "good");
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
    answerQuizzes,
    setAnswerQuizzes,
    authed,
    username,
    setUsername,
    refreshMe,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}