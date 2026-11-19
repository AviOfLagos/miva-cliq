"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/run/AppContext";
import ReconnectPrompt from "@/app/components/ReconnectPrompt";
import {
  buildPrompts,
  chatGptUrl,
  cleanWeekTitle,
  GEMINI_URL,
  VARIANTS,
  type PromptVariant,
  type SampleQuestion,
} from "@/lib/study/prompts";
import { loadGeminiKey } from "@/lib/run/prefs";
import { courseSummary, weekCoverage } from "@/lib/practice/coverage";
import { BANK_TARGET } from "@/lib/practice/targets";
import { usePrepare, type PrepState } from "./usePrepare";

type Course = { id: number; fullname: string };

type Week = {
  weekNumber: number;
  weekTitle: string;
  topics: string[];
  sampleQuestions: SampleQuestion[];
  practiceCount?: number | null;
  hasNotes?: boolean | null;
};

type CourseData = {
  course: { id: number; fullname: string; code: string | null };
  weeks: Week[];
  target?: number;
};

const KEY_HREF = "/study/key?back=%2Fstudy";

/** Clipboard API first; the hidden-textarea fallback covers older phones and http. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function WeekCard({ data, week }: { data: CourseData; week: Week }) {
  const [variant, setVariant] = useState<PromptVariant>("teach");
  const [status, setStatus] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prompts = useMemo(
    () =>
      buildPrompts({
        courseTitle: data.course.fullname,
        courseCode: data.course.code,
        weekNumber: week.weekNumber,
        weekTitle: week.weekTitle,
        topics: week.topics,
        sampleQuestions: week.sampleQuestions,
      }),
    [data, week],
  );
  const prompt = prompts[variant];
  const title = cleanWeekTitle(week.weekTitle);
  const blurb = VARIANTS.find((v) => v.id === variant)?.blurb;
  const coverage = weekCoverage(week.practiceCount, data.target ?? BANK_TARGET);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    async (okMessage: string) => {
      const ok = await copyText(prompt);
      if (timer.current) clearTimeout(timer.current);
      if (ok) {
        setStatus(okMessage);
        timer.current = setTimeout(() => setStatus(null), 4000);
      } else {
        setShowPrompt(true);
        setStatus("Couldn't copy on this phone. Press and hold the prompt below to select it.");
      }
    },
    [prompt],
  );

  return (
    <li className="answer-card">
      <div className="answer-meta-row">
        <span className="pill pill-ghost">Week {week.weekNumber}</span>
        {week.hasNotes && <span className="pill pill-ghost">Notes from course material</span>}
        {week.sampleQuestions.length > 0 && (
          <span className="pill pill-good">
            {week.sampleQuestions.length} real question{week.sampleQuestions.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {title && <h2 className="study-week-title">{title}</h2>}
      {coverage.label && <p className={`coverage-line is-${coverage.kind}`}>{coverage.label}</p>}

      {data.course.code && (
        <Link
          className="btn btn-primary btn-block practice-cta"
          href={`/study/practice?course=${encodeURIComponent(data.course.code)}&week=${week.weekNumber}&cid=${data.course.id}`}
        >
          {coverage.kind === "empty" ? "Add questions for this week" : "Practise"}
        </Link>
      )}

      <p className="answer-value-label">What to know this week</p>
      {week.topics.length ? (
        <ul className="study-topics">
          {week.topics.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="subtle">No topic list on Miva for this week, so the prompt uses the week&apos;s title.</p>
      )}

      <div className="filter-chips" role="group" aria-label="Kind of prompt">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`chip-btn ${variant === v.id ? "is-active" : ""}`}
            aria-pressed={variant === v.id}
            onClick={() => {
              setVariant(v.id);
              setStatus(null);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      {blurb && <p className="subtle">{blurb}</p>}

      <details open={showPrompt} onToggle={(e) => setShowPrompt(e.currentTarget.open)}>
        <summary className="subtle">See the prompt</summary>
        <p className="answer-question study-prompt">{prompt}</p>
      </details>

      <div className="answer-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy("Copied. Paste it into any chatbot.")}>
          {status?.startsWith("Copied") ? "Copied ✓" : "Copy prompt"}
        </button>
        <a
          className="btn btn-ghost btn-sm"
          href={chatGptUrl(prompt)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => copy("Copied too, in case ChatGPT opens empty.")}
        >
          Open in ChatGPT
        </a>
        <a
          className="btn btn-ghost btn-sm"
          href={GEMINI_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => copy("Copied. Paste it into Gemini.")}
        >
          Open in Gemini
        </a>
      </div>
      <p className="subtle" aria-live="polite">
        {status ?? ""}
      </p>
    </li>
  );
}

function PreparePanel({ state, onStop }: { state: PrepState; onStop: () => void }) {
  if (!state.lines.length && !state.message) return null;
  const done = state.lines.filter((l) => l.status === "ready").length;
  return (
    <div className="card prepare-panel" aria-live="polite">
      {state.lines.length > 0 && (
        <p className="prepare-head">
          {done} of {state.lines.length} week{state.lines.length === 1 ? "" : "s"} ready
        </p>
      )}
      {state.message && <p className="subtle prepare-message">{state.message}</p>}
      {state.fixKey && (
        <Link href={KEY_HREF} className="btn btn-ghost btn-sm">
          Check my key
        </Link>
      )}
      {state.lines.length > 0 && (
        <ul className="prepare-list">
          {state.lines.map((l) => (
            <li key={l.key} className={`prepare-row is-${l.status}`}>
              <span>{l.label}</span>
              <span className="prepare-row-state">
                {l.status === "working"
                  ? "Working…"
                  : l.status === "ready"
                    ? `Ready: ${l.count ?? ""}`
                    : l.status === "partial"
                      ? `${l.count ?? 0} so far`
                      : l.status === "failed"
                        ? "Skipped"
                        : "Waiting"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {state.running && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
}

function PrepareButton({
  hasKey,
  running,
  label,
  onClick,
}: {
  hasKey: boolean;
  running: boolean;
  label: string;
  onClick: () => void;
}) {
  if (!hasKey) {
    return (
      <Link href={KEY_HREF} className="btn btn-ghost btn-sm">
        {label}: add your free Gemini key
      </Link>
    );
  }
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onClick} disabled={running}>
      {running ? "Preparing…" : label}
    </button>
  );
}

export default function StudyClient() {
  const { authed } = useApp();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedOut, setLoggedOut] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [data, setData] = useState<CourseData | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => setHasKey(!!loadGeminiKey()), []);

  const onCount = useCallback((courseId: number, week: number, count: number) => {
    setData((d) =>
      d && d.course.id === courseId
        ? { ...d, weeks: d.weeks.map((w) => (w.weekNumber === week ? { ...w, practiceCount: count } : w)) }
        : d,
    );
  }, []);
  const prep = usePrepare({ getKey: loadGeminiKey, onCount });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/courses", { credentials: "include" });
        if (!alive) return;
        if (res.status === 401) {
          setLoggedOut(true);
          return;
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error();
        setLoggedOut(false);
        setCourses(Array.isArray(body?.courses) ? body.courses : []);
      } catch {
        if (alive) setError("We couldn't load your courses from Miva. Check your connection and try again.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authed]);

  const choose = useCallback(async (id: number) => {
    setSelected(id);
    setData(null);
    setError(null);
    setReading(true);
    try {
      const res = await fetch(`/api/study?courseId=${id}`, { credentials: "include" });
      if (res.status === 401) {
        setLoggedOut(true);
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "");
      setData(body as CourseData);
    } catch (e: any) {
      setError(e?.message || "We couldn't read this course. Try again in a minute.");
    } finally {
      setReading(false);
    }
  }, []);

  if (loggedOut && authed) {
    // Signed in for 30 days, but the 2-hour Miva session has lapsed.
    return (
      <section className="answers-page">
        <header className="answers-head">
          <h1>Study</h1>
        </header>
        <ReconnectPrompt what="load your courses" />
        <p className="subtle">
          Or practise without reconnecting: <Link href="/study/browse">browse all courses</Link> that classmates have
          prepared.
        </p>
      </section>
    );
  }

  if (loggedOut || (!authed && !loading && !courses.length && !error)) {
    return (
      <section className="answers-page">
        <header className="answers-head">
          <h1>Study</h1>
          <p className="subtle">
            Log in with your Miva account and we&apos;ll make ready-to-paste study prompts for
            every week of your courses.
          </p>
        </header>
        <Link href="/cliq" className="btn btn-primary">
          Log in
        </Link>
      </section>
    );
  }

  const current = courses.find((c) => c.id === selected);

  return (
    <section className="answers-page">
      <header className="answers-head">
        <h1>Study</h1>
        <p className="subtle">
          Pick a course. Each week gets three ready-made prompts: copy one into ChatGPT,
          Gemini or Grok and it will teach you, test you, or drill you for the exam. Nothing
          is sent to any AI from here. Want the course files offline?{" "}
          <Link href="/study-pack">Get the study pack</Link>.
        </p>
        <p className="subtle">
          Practice questions are made once and shared with everyone on the course. Pick a week that still needs
          questions, or <Link href="/study/browse">browse all courses</Link> to practise any course classmates have
          prepared.
        </p>
      </header>

      {!loading && courses.length > 0 && !current && (
        <div className="prepare-bar">
          <PrepareButton
            hasKey={hasKey}
            running={prep.state.running}
            label="Prepare all my courses"
            onClick={() => prep.run(courses)}
          />
          <p className="subtle prepare-hint">
            Uses your own free Gemini key to fill every week of your courses with questions, one week at a time.
            You can stop and carry on later.
          </p>
        </div>
      )}
      <PreparePanel state={prep.state} onStop={prep.stop} />

      {loading && <p className="subtle">Loading your courses…</p>}
      {!loading && !error && courses.length === 0 && (
        <p className="alert alert-notice">
          We couldn&apos;t find any courses on your Miva account yet. Once you&apos;re enrolled,
          they&apos;ll show up here.
        </p>
      )}

      {current ? (
        <div className="pack-list">
          <div className="select-card pack-card is-selected">
            <span className="select-card-title">{current.fullname}</span>
            <span className="select-card-sub">
              {reading
                ? "Reading this course…"
                : data
                  ? courseSummary(
                      data.weeks.map((w) => w.practiceCount),
                      data.target ?? BANK_TARGET,
                    ) || `${data.weeks.length} week${data.weeks.length === 1 ? "" : "s"}`
                  : ""}
            </span>
          </div>
          {data && data.weeks.length > 0 && data.course.code && (
            <PrepareButton
              hasKey={hasKey}
              running={prep.state.running}
              label="Prepare this course"
              onClick={() => prep.run([{ id: data.course.id, fullname: data.course.fullname }])}
            />
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSelected(null);
              setData(null);
              setError(null);
            }}
          >
            Change course
          </button>
        </div>
      ) : (
        <ul className="pack-list">
          {courses.map((c) => (
            <li key={c.id}>
              <button type="button" className="select-card pack-card" onClick={() => choose(c.id)}>
                <span className="select-card-title">{c.fullname}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
          {selected && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose(selected)}>
              Try again
            </button>
          )}
        </p>
      )}

      {data && data.weeks.length === 0 && (
        <p className="alert alert-notice">
          This course has no weekly topics on Miva yet. Lecturers often add them as the semester
          goes on, so check back next week.
        </p>
      )}

      {data && data.weeks.length > 0 && (
        <ul className="answers-list">
          {data.weeks.map((w) => (
            <WeekCard key={w.weekNumber} data={data} week={w} />
          ))}
        </ul>
      )}
    </section>
  );
}
