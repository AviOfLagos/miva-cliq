"use client";

/**
 * Browse all courses: every course a student has opened on Study, with how
 * many weeks are ready, so anyone signed in can practise any course, in any
 * department, enrolled or not. Reads only our own saved outlines and bank
 * counts: no LMS session needed.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { courseSummary, weekCoverage } from "@/lib/practice/coverage";
import { BANK_TARGET } from "@/lib/practice/targets";
import { cleanWeekTitle, displayCode } from "@/lib/study/prompts";

type BrowseCourse = { courseCode: string; courseTitle: string; weeks: number; ready: number; started: number };
type BrowseWeek = { week: number; weekTitle: string; count: number | null; hasNotes: boolean | null };
type CourseWeeks = { courseCode: string; courseTitle: string; weeks: BrowseWeek[]; target: number };

type Phase = "loading" | "loggedOut" | "unavailable" | "error" | "ready";

export default function BrowseClient() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [courses, setCourses] = useState<BrowseCourse[]>([]);
  const [target, setTarget] = useState(BANK_TARGET);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<CourseWeeks | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch("/api/practice/courses", { credentials: "include" });
      if (res.status === 401) return setPhase("loggedOut");
      const body = await res.json().catch(() => null);
      if (res.status === 503 && body?.unavailable) return setPhase("unavailable");
      if (!res.ok || !body) return setPhase("error");
      setCourses(Array.isArray(body.courses) ? body.courses : []);
      setTarget(Number(body.target) || BANK_TARGET);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const choose = async (code: string) => {
    setOpening(code);
    setOpenError(null);
    try {
      const res = await fetch(`/api/practice/courses?code=${encodeURIComponent(code)}`, { credentials: "include" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error || "");
      setOpen(body as CourseWeeks);
    } catch (e: any) {
      setOpenError(e?.message || "We couldn't open that course. Try again in a minute.");
    } finally {
      setOpening(null);
    }
  };

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase().replace(/\s+/g, "");
    const list = f
      ? courses.filter((c) => c.courseCode.includes(f) || c.courseTitle.toLowerCase().replace(/\s+/g, "").includes(f))
      : courses;
    // Most-prepared first, so the courses you can practise right now lead.
    return [...list].sort((a, b) => b.ready - a.ready || b.started - a.started || a.courseCode.localeCompare(b.courseCode));
  }, [courses, filter]);

  const header = (
    <header className="answers-head">
      <Link href="/study" className="subtle practice-back">
        ← Study
      </Link>
      <h1>Browse all courses</h1>
      <p className="subtle">
        Every course a classmate has opened, in any department. Practise any week that has questions, even if
        you&apos;re not enrolled. Weeks with no questions yet are filled by students on that course.
      </p>
    </header>
  );

  if (phase === "loading") {
    return (
      <section className="answers-page">
        {header}
        <p className="subtle">Loading courses…</p>
      </section>
    );
  }
  if (phase === "loggedOut") {
    return (
      <section className="answers-page">
        {header}
        <p className="subtle">Log in with your Miva account to practise.</p>
        <Link href="/cliq" className="btn btn-primary">
          Log in
        </Link>
      </section>
    );
  }
  if (phase === "unavailable" || phase === "error") {
    return (
      <section className="answers-page">
        {header}
        <p className={`alert ${phase === "unavailable" ? "alert-notice" : "alert-error"}`} role="alert">
          {phase === "unavailable"
            ? "Practice isn't available yet. Your study prompts on the Study page still work."
            : "We couldn't load the course list. Check your connection and try again."}
        </p>
        {phase === "error" && (
          <button type="button" className="btn btn-primary" onClick={load}>
            Try again
          </button>
        )}
      </section>
    );
  }

  if (open) {
    const code = displayCode(open.courseCode);
    const summary = courseSummary(
      open.weeks.map((w) => w.count),
      open.target || target,
    );
    return (
      <section className="answers-page">
        {header}
        <div className="pack-list">
          <div className="select-card pack-card is-selected">
            <span className="select-card-title">{open.courseTitle || code}</span>
            <span className="select-card-sub">{summary}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
            All courses
          </button>
        </div>
        <ul className="answers-list">
          {open.weeks.map((w) => {
            const cov = weekCoverage(w.count, open.target || target);
            const title = cleanWeekTitle(w.weekTitle);
            return (
              <li key={w.week} className="answer-card">
                <div className="answer-meta-row">
                  <span className="pill pill-ghost">Week {w.week}</span>
                  {w.hasNotes && <span className="pill pill-ghost">Notes from course material</span>}
                </div>
                {title && <h2 className="study-week-title">{title}</h2>}
                {cov.label && <p className={`coverage-line is-${cov.kind}`}>{cov.label}</p>}
                {cov.kind === "ready" || cov.kind === "started" ? (
                  <Link
                    className="btn btn-primary btn-block practice-cta"
                    href={`/study/practice?course=${encodeURIComponent(open.courseCode)}&week=${w.week}`}
                  >
                    Practise
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <section className="answers-page">
      {header}
      {courses.length > 0 && (
        <input
          className="input browse-filter"
          type="search"
          inputMode="search"
          placeholder="Find a course: code or title"
          aria-label="Find a course"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {openError && (
        <p className="alert alert-error" role="alert">
          {openError}
        </p>
      )}
      {courses.length === 0 ? (
        <p className="alert alert-notice">
          No courses yet. Open one of your own courses on the Study page and it will appear here for everyone.
        </p>
      ) : shown.length === 0 ? (
        <p className="subtle">No course matches that.</p>
      ) : (
        <ul className="pack-list">
          {shown.map((c) => (
            <li key={c.courseCode}>
              <button
                type="button"
                className="select-card pack-card"
                onClick={() => choose(c.courseCode)}
                disabled={!!opening}
              >
                <span className="select-card-title">
                  {displayCode(c.courseCode)}
                  {c.courseTitle ? ` · ${c.courseTitle}` : ""}
                </span>
                <span className="select-card-sub">
                  {opening === c.courseCode
                    ? "Opening…"
                    : `${c.ready} of ${c.weeks} week${c.weeks === 1 ? "" : "s"} ready${
                        c.started > c.ready ? `, ${c.started - c.ready} started` : ""
                      }`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
