"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/run/AppContext";
import ReconnectPrompt from "@/app/components/ReconnectPrompt";

type Course = { id: number; fullname: string };

type Plan = {
  courseId: number;
  courseName: string;
  documents: { cmid: number; name: string; modname: string; section: number | null }[];
  quizzes: { cmid: number; name: string; section: number | null }[];
  excludedQuizzes: { cmid: number; name: string; reason: string }[];
};

type Report = {
  courseName: string;
  filename: string;
  documentCount: number;
  noteCount: number;
  quizCount: number;
  questionCount: number;
  linkCount: number;
  bytes: number;
  skipped: { name: string; reason: string }[];
};

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StudyPackClient() {
  const { authed } = useApp();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [openAttempts, setOpenAttempts] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [building, setBuilding] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The Miva session lapsed (401) while the 30-day identity is still valid.
  const [needsLms, setNeedsLms] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/courses", { credentials: "include" });
        if (!alive) return;
        if (res.status === 401) {
          setNeedsLms(true);
          return;
        }
        setNeedsLms(false);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data?.error || "Could not load your courses.");
        setCourses(Array.isArray(data.courses) ? data.courses : []);
      } catch (e: any) {
        if (alive) setError(e?.message || "Could not load your courses.");
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
    setPlan(null);
    setReport(null);
    setError(null);
    setPlanning(true);
    try {
      const res = await fetch(`/api/export?courseId=${id}&plan=1`, { credentials: "include" });
      if (res.status === 401) {
        setNeedsLms(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not read that course.");
      setPlan(data.plan);
    } catch (e: any) {
      setError(e?.message || "Could not read that course.");
    } finally {
      setPlanning(false);
    }
  }, []);

  const download = useCallback(async () => {
    if (!selected) return;
    setBuilding(true);
    setError(null);
    setReport(null);
    try {
      const url = `/api/export?courseId=${selected}${openAttempts ? "&open=1" : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401) {
        setNeedsLms(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Pack failed (${res.status}).`);
      }
      const raw = res.headers.get("x-pack-report");
      const blob = await res.blob();
      const name =
        (raw ? (JSON.parse(decodeURIComponent(raw)) as Report).filename : null) || "study-pack.zip";
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      if (raw) setReport(JSON.parse(decodeURIComponent(raw)) as Report);
    } catch (e: any) {
      setError(e?.message || "Could not build the pack.");
    } finally {
      setBuilding(false);
    }
  }, [selected, openAttempts]);

  if (!authed && !loading && !courses.length) {
    return (
      <section className="answers-page">
        <header className="answers-head">
          <h1>Study pack</h1>
          <p className="subtle">
            Log in with your Miva account to download a course&apos;s documents and
            practice questions as one offline folder.
          </p>
        </header>
        <Link href="/cliq" className="btn btn-primary">
          Log in
        </Link>
      </section>
    );
  }

  return (
    <section className="answers-page">
      <header className="answers-head">
        <h1>Study pack</h1>
        <p className="subtle">
          Pick a course and get a zip named after it: every document the lecturer
          shared, plus one markdown file per <strong>ungraded practice quiz</strong>{" "}
          with its questions and options. Unzip it into NotebookLM, or just read it
          offline. Graded quizzes are never included.
        </p>
      </header>

      {needsLms && authed ? (
        <ReconnectPrompt what="build a study pack" />
      ) : (
        error && <p className="alert alert-error">{error}</p>
      )}
      {loading && <p className="subtle">Loading your courses…</p>}

      <ul className="pack-list">
        {courses.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`select-card pack-card ${selected === c.id ? "is-selected" : ""}`}
              onClick={() => choose(c.id)}
              aria-pressed={selected === c.id}
            >
              <span className="select-card-title">{c.fullname}</span>
              {selected === c.id && planning && (
                <span className="select-card-sub">Reading course…</span>
              )}
              {selected === c.id && plan && (
                <span className="select-card-sub">
                  {plan.documents.length} item{plan.documents.length === 1 ? "" : "s"} ·{" "}
                  {plan.quizzes.length} ungraded quiz
                  {plan.quizzes.length === 1 ? "" : "zes"}
                  {plan.excludedQuizzes.length
                    ? ` · ${plan.excludedQuizzes.length} graded skipped`
                    : ""}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {plan && (
        <div className="card pack-actions">
          <label className={`check-row ${openAttempts ? "is-checked" : ""}`}>
            <input
              type="checkbox"
              checked={openAttempts}
              onChange={(e) => setOpenAttempts(e.target.checked)}
            />
            <span className="checkbox" aria-hidden="true">
              {openAttempts ? "✓" : ""}
            </span>
            <span className="check-label">
              Open unattempted quizzes to read their questions
              <span className="subtle">
                {" "}
                — starts an attempt (never submits it) on practice quizzes you have
                never taken. Without this, only quizzes you have already attempted can
                be exported.
              </span>
            </span>
          </label>

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={download}
            disabled={building}
          >
            {building ? "Building pack…" : `Download ${plan.courseName} pack`}
          </button>
          {building && (
            <p className="subtle">
              Downloading every document can take a minute or two. Keep this tab open.
            </p>
          )}
        </div>
      )}

      {report && (
        <div className="card">
          <h2 className="section-title">{report.filename}</h2>
          <p className="subtle">
            {report.documentCount} document{report.documentCount === 1 ? "" : "s"} ·{" "}
            {report.noteCount} note{report.noteCount === 1 ? "" : "s"} · {report.quizCount}{" "}
            quiz{report.quizCount === 1 ? "" : "zes"} ({report.questionCount} questions) ·{" "}
            {report.linkCount} link{report.linkCount === 1 ? "" : "s"} · {human(report.bytes)}
          </p>
          {report.skipped.length > 0 && (
            <>
              <p className="subtle">Not included:</p>
              <ul className="activity-list">
                {report.skipped.map((s, i) => (
                  <li key={`${s.name}-${i}`} className="activity-item">
                    <span className="activity-name">{s.name}</span>
                    <span className="subtle"> — {s.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
