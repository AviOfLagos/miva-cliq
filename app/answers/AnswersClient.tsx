"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/run/AppContext";

type Answer = {
  questionHash: string;
  questionText: string;
  qtype: string;
  answerText: string;
  status: "unconfirmed" | "confirmed";
  confirmCount: number;
  refuteCount: number;
  courseCode: string | null;
  section: number | null;
  updatedAt: number;
};

export default function AnswersClient() {
  const { authed } = useApp();
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async (courseCode: string) => {
    setLoading(true);
    try {
      const qs = courseCode ? `?courseCode=${encodeURIComponent(courseCode)}` : "";
      const res = await fetch(`/api/quiz-answers${qs}`, { credentials: "include" });
      const data = await res.json();
      setAnswers(Array.isArray(data.answers) ? data.answers : []);
      setEnabled(data.enabled !== false);
    } catch {
      setAnswers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  const onFilter = (e: React.FormEvent) => {
    e.preventDefault();
    load(course.trim().toLowerCase());
  };

  const patch = (a: Answer) =>
    setAnswers((prev) => prev.map((x) => (x.questionHash === a.questionHash ? a : x)));

  const visible = query.trim()
    ? answers.filter((a) =>
        (a.questionText + a.answerText).toLowerCase().includes(query.trim().toLowerCase()),
      )
    : answers;

  return (
    <section className="answers-page">
      <header className="answers-head">
        <h1>Answer bank</h1>
        <p className="subtle">
          Crowd-verified answers for <strong>ungraded practice quizzes</strong>. These
          fill in automatically as students run them, and anyone logged in can correct
          an answer. Graded assessments are never included.
        </p>
      </header>

      <form className="answers-filters" onSubmit={onFilter}>
        <input
          className="answers-input"
          placeholder="Course code (e.g. COS202)"
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          aria-label="Filter by course code"
        />
        <button type="submit" className="btn btn-ghost btn-sm">
          Filter
        </button>
        <input
          className="answers-input answers-search"
          placeholder="Search questions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search questions"
        />
      </form>

      {!enabled && <p className="subtle">The answer bank isn&apos;t available right now.</p>}
      {loading && <p className="subtle">Loading…</p>}
      {!loading && enabled && visible.length === 0 && (
        <p className="subtle">
          No answers yet{course ? ` for “${course}”` : ""}. They appear here after a run
          with the ungraded-quiz option turned on.
        </p>
      )}

      <ul className="answers-list">
        {visible.map((a) => (
          <AnswerRow key={a.questionHash} answer={a} authed={authed} onChange={patch} />
        ))}
      </ul>
    </section>
  );
}

function AnswerRow({
  answer,
  authed,
  onChange,
}: {
  answer: Answer;
  authed: boolean;
  onChange: (a: Answer) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(answer.answerText);
  const [busy, setBusy] = useState(false);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/quiz-answers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ questionHash: answer.questionHash, ...body }),
      });
      const data = await res.json();
      if (data.answer) onChange(data.answer);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

  return (
    <li className="answer-card">
      <div className="answer-meta-row">
        {answer.courseCode && <span className="pill pill-ghost">{answer.courseCode.toUpperCase()}</span>}
        {answer.section != null && <span className="pill pill-ghost">Wk {answer.section}</span>}
        <span className={`pill ${answer.status === "confirmed" ? "pill-good" : "pill-warn"}`}>
          {answer.status === "confirmed" ? "✓ confirmed" : "unconfirmed"}
        </span>
      </div>
      <p className="answer-question">{answer.questionText}</p>

      {editing ? (
        <div className="answer-edit">
          <textarea
            className="answers-input"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Correct answer"
          />
          <div className="answer-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !draft.trim()}
              onClick={() => act({ action: "edit", answerText: draft })}
            >
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="answer-value">
          <span className="answer-value-label">Answer:</span> {answer.answerText}
        </p>
      )}

      {authed && !editing && (
        <div className="answer-actions">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: "confirm" })}>
            👍 Correct ({answer.confirmCount})
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: "refute" })}>
            👎 Wrong ({answer.refuteCount})
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => {
              setDraft(answer.answerText);
              setEditing(true);
            }}
          >
            ✎ Edit
          </button>
        </div>
      )}
      {!authed && <p className="subtle answer-login-hint">Log in on Autopilot to correct answers.</p>}
    </li>
  );
}
