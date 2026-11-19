"use client";

/**
 * Runs "Prepare this course" / "Prepare all my courses" from the browser: for
 * each course, read its weeks fresh from /api/study, queue the weeks below the
 * bank target, then make ONE /api/practice/generate call per week, one at a
 * time, with a pause between calls. The rules (which weeks, when to repeat a week, when to
 * stop) live in lib/practice/prepare.ts. The key goes only to our own server,
 * in the same header the practice page uses.
 */
import { useCallback, useRef, useState } from "react";
import { decide, outcomeOf, PAUSE_MS, STOP_MESSAGES, weeksToPrepare, type PrepWeek } from "@/lib/practice/prepare";
import { BANK_TARGET } from "@/lib/practice/targets";
import { displayCode } from "@/lib/study/prompts";

export type PrepCourse = { id: number; fullname: string };

export type PrepLine = {
  key: string;
  label: string;
  status: "waiting" | "working" | "ready" | "partial" | "failed";
  count: number | null;
};

export type PrepState = {
  running: boolean;
  lines: PrepLine[];
  /** Plain-words status: what is happening now, or why it stopped. */
  message: string | null;
  fixKey: boolean;
  finished: boolean;
};

const IDLE: PrepState = { running: false, lines: [], message: null, fixKey: false, finished: false };

type StudyWeek = { weekNumber: number; practiceCount?: number | null };

function sleep(ms: number, stopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (stopped() || Date.now() - started >= ms) return resolve();
      setTimeout(tick, 250);
    };
    tick();
  });
}

export function usePrepare(opts: {
  getKey: () => string;
  /** Called after each call with the week's new bank size, so the page's week cards update. */
  onCount?: (courseId: number, week: number, count: number) => void;
}) {
  const [state, setState] = useState<PrepState>(IDLE);
  const stopRef = useRef(false);
  const { getKey, onCount } = opts;

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const run = useCallback(
    async (courses: PrepCourse[]) => {
      const key = getKey();
      if (!key || !courses.length) return;
      stopRef.current = false;
      const lines: PrepLine[] = [];
      const push = (patch: Partial<PrepState>) =>
        setState((s) => ({ ...s, ...patch, lines: [...lines] }));
      const setLine = (i: number, patch: Partial<PrepLine>) => {
        lines[i] = { ...lines[i], ...patch };
      };
      push({ running: true, message: "Reading your courses…", fixKey: false, finished: false });

      // 1. Fresh week counts for every course (this also saves their outlines).
      type Item = PrepWeek & { line: number };
      const queue: Item[] = [];
      for (const c of courses) {
        if (stopRef.current) break;
        let body: any = null;
        try {
          const res = await fetch(`/api/study?courseId=${c.id}`, { credentials: "include" });
          if (res.status === 401) {
            push({ running: false, message: STOP_MESSAGES.logged_out, finished: true });
            return;
          }
          body = await res.json().catch(() => null);
          if (!res.ok) body = null;
        } catch {
          body = null;
        }
        const code: string | null = body?.course?.code ?? null;
        const weeks: StudyWeek[] = Array.isArray(body?.weeks) ? body.weeks : [];
        if (!code || !weeks.length) continue;
        const target = Number(body?.target) || BANK_TARGET;
        const todo = weeksToPrepare(
          weeks.map((w) => ({ courseCode: code, courseId: c.id, week: w.weekNumber, count: w.practiceCount ?? null })),
          target,
        );
        for (const w of todo) {
          lines.push({
            key: `${code}-${w.week}`,
            label: `${displayCode(code) ?? code} week ${w.week}`,
            status: "waiting",
            count: w.count,
          });
          queue.push({ ...w, line: lines.length - 1 });
        }
      }

      if (!queue.length) {
        push({
          running: false,
          finished: true,
          message: stopRef.current
            ? "Stopped."
            : "Every week we could read is already ready, or practice isn't switched on yet. Nothing to do.",
        });
        return;
      }

      // 2. One week at a time, one call at a time.
      let failuresInRow = 0;
      let made = 0;
      for (let qi = 0; qi < queue.length; qi++) {
        const item = queue[qi];
        setLine(item.line, { status: "working" });
        {
          if (made > 0) {
            push({ message: `Pausing so your free Gemini limit isn't used up too fast…` });
            await sleep(PAUSE_MS, () => stopRef.current);
          }
          if (stopRef.current) {
            setLine(item.line, { status: item.count && item.count > 0 ? "partial" : "waiting" });
            push({ running: false, finished: true, message: "Stopped. Press Prepare again to carry on." });
            return;
          }
          push({ message: `Creating questions for ${lines[item.line].label} (${qi + 1} of ${queue.length})…` });
          made += 1;
          let status = 0;
          let json: any = null;
          try {
            const res = await fetch("/api/practice/generate", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json", "x-gemini-key": key },
              body: JSON.stringify({ courseCode: item.courseCode, week: item.week, courseId: item.courseId }),
            });
            status = res.status;
            json = await res.json().catch(() => null);
          } catch {
            status = 0;
          }
          const outcome = outcomeOf(status, json);
          failuresInRow = outcome.kind === "failed" ? failuresInRow + 1 : 0;
          if (outcome.kind === "added" || outcome.kind === "full") {
            item.count = outcome.bankSize;
            setLine(item.line, { count: outcome.bankSize });
            if (item.courseId) onCount?.(item.courseId, item.week, outcome.bankSize);
          }
          const step = decide(outcome, failuresInRow);
          if (step.action === "next") {
            setLine(item.line, {
              status: step.done ? "ready" : item.count && item.count > 0 ? "partial" : "failed",
            });
            continue;
          }
          setLine(item.line, { status: item.count && item.count > 0 ? "partial" : "waiting" });
          push({ running: false, finished: true, message: step.message, fixKey: !!step.fixKey });
          return;
        }
      }
      const ready = lines.filter((l) => l.status === "ready").length;
      push({
        running: false,
        finished: true,
        message: `Done. ${ready} of ${lines.length} week${lines.length === 1 ? "" : "s"} now ready. Thanks: everyone on these courses can practise them now.`,
      });
    },
    [getKey, onCount],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { state, run, stop, reset };
}
