"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cleanWeekTitle, displayCode } from "@/lib/study/prompts";
import { loadGeminiKey } from "@/lib/run/prefs";

/* Mirrors ServedQuestion in lib/practice/core.ts (not imported: that module uses node:crypto). */
type Question = { id: string; question: string; options: string[]; status: "unconfirmed" | "confirmed" };

type SetData = {
  courseTitle: string;
  weekTitle: string;
  week: number;
  nextWeek: number | null;
  bankSize: number;
  target: number;
  canGenerate: boolean;
  questions: Question[];
};

type Result = { correct: boolean; correctOption: string; explanation: string };

type Phase =
  | { k: "loading" }
  | { k: "loggedOut" }
  | { k: "unavailable" }
  | { k: "error"; msg: string }
  | { k: "needKey" }
  | { k: "generating" }
  | { k: "genError"; msg: string; badKey: boolean }
  | { k: "quiz" }
  | { k: "done" };

const KEY_PAGE = "/study/key";

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as any;
  return { res, json };
}

export default function PracticeClient({
  course,
  week,
  courseId = null,
}: {
  course: string;
  week: number;
  courseId?: number | null;
}) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [set, setSet] = useState<SetData | null>(null);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);
  const [score, setScore] = useState<boolean[]>([]);
  const [reported, setReported] = useState<Record<string, "sending" | "done">>({});
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const generatedOnce = useRef(false);

  const here = `/study/practice?course=${encodeURIComponent(course)}&week=${week}${courseId ? `&cid=${courseId}` : ""}`;
  const keyHref = `${KEY_PAGE}?back=${encodeURIComponent(here)}`;

  const start = useCallback((s: SetData) => {
    setSet(s);
    setIndex(0);
    setChosen(null);
    setResult(null);
    setScore([]);
    setAnswerError(null);
    setPhase(s.questions.length ? { k: "quiz" } : { k: "needKey" });
  }, []);

  const fetchSet = useCallback(async (): Promise<SetData | null> => {
    const { res, json } = await post("/api/practice/set", { courseCode: course, week });
    if (res.status === 401) {
      setPhase({ k: "loggedOut" });
      return null;
    }
    if (res.status === 503 && json?.unavailable) {
      setPhase({ k: "unavailable" });
      return null;
    }
    if (!res.ok || !json) {
      setPhase({ k: "error", msg: json?.error || "We couldn't load practice questions. Try again in a minute." });
      return null;
    }
    return json as SetData;
  }, [course, week]);

  const generate = useCallback(
    async (key: string, current: SetData) => {
      generatedOnce.current = true;
      setSet(current);
      setPhase({ k: "generating" });
      try {
        const { res, json } = await post(
          "/api/practice/generate",
          { courseCode: course, week, ...(courseId ? { courseId } : {}) },
          { "x-gemini-key": key },
        );
        if (res.status === 401) return setPhase({ k: "loggedOut" });
        if (res.status === 503 && json?.unavailable) return setPhase({ k: "unavailable" });
        // 409 = someone else filled the week meanwhile: just practise.
        if (res.ok || res.status === 409) {
          const fresh = await fetchSet();
          if (fresh) start(fresh);
          return;
        }
        setPhase({
          k: "genError",
          msg: json?.error || "We couldn't create questions this time. Try again in a minute.",
          badKey: json?.keyError === "invalid_key",
        });
      } catch {
        setPhase({ k: "genError", msg: "Your connection dropped while creating questions. Try again.", badKey: false });
      }
    },
    [course, week, courseId, fetchSet, start],
  );

  const load = useCallback(async () => {
    setPhase({ k: "loading" });
    try {
      const s = await fetchSet();
      if (!s) return;
      // Weeks with a full bank never trigger generation; thin ones do, once per visit.
      if (s.canGenerate && !generatedOnce.current) {
        const key = loadGeminiKey();
        if (key) return void generate(key, s);
        // Ask once per visit: "Practise again" after this goes straight to questions.
        generatedOnce.current = true;
        setSet(s);
        return setPhase({ k: "needKey" });
      }
      start(s);
    } catch {
      setPhase({ k: "error", msg: "Check your connection and try again." });
    }
  }, [fetchSet, generate, start]);

  useEffect(() => {
    if (!course) {
      setPhase({ k: "error", msg: "Pick a week on the Study page, then tap Practise." });
      return;
    }
    load();
  }, [course, load]);

  useEffect(() => {
    if (phase.k !== "generating") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase.k]);

  const q = set?.questions[index];

  const answer = async (option: string) => {
    if (!q || chosen || checking) return;
    setChosen(option);
    setChecking(true);
    setAnswerError(null);
    try {
      const { res, json } = await post("/api/practice/answer", { questionId: q.id, choice: option });
      if (!res.ok || !json) throw new Error(json?.error || "");
      setResult(json as Result);
      setScore((s) => [...s, !!json.correct]);
    } catch (e: any) {
      setChosen(null);
      setAnswerError(e?.message || "We couldn't check that answer. Tap it again.");
    } finally {
      setChecking(false);
    }
  };

  const next = () => {
    if (!set) return;
    if (index + 1 >= set.questions.length) {
      setPhase({ k: "done" });
      return;
    }
    setIndex((i) => i + 1);
    setChosen(null);
    setResult(null);
    setAnswerError(null);
  };

  const report = async (id: string) => {
    if (reported[id]) return;
    setReported((r) => ({ ...r, [id]: "sending" }));
    try {
      const { res } = await post("/api/practice/report", { questionId: id });
      if (!res.ok) throw new Error();
      setReported((r) => ({ ...r, [id]: "done" }));
    } catch {
      setReported((r) => {
        const { [id]: _drop, ...rest } = r;
        return rest;
      });
    }
  };

  const code = displayCode(course);
  const weekLabel = set && cleanWeekTitle(set.weekTitle) ? `Week ${week}: ${cleanWeekTitle(set.weekTitle)}` : `Week ${week}`;

  const header = (
    <header className="answers-head practice-head">
      <Link href="/study" className="subtle practice-back">
        ← Study
      </Link>
      <h1>{code ? `${code} practice` : "Practice"}</h1>
      {course && <p className="subtle">{weekLabel}</p>}
    </header>
  );

  if (phase.k === "loading") {
    return (
      <section className="answers-page practice-page">
        {header}
        <p className="subtle">Getting your questions…</p>
      </section>
    );
  }

  if (phase.k === "loggedOut") {
    return (
      <section className="answers-page practice-page">
        {header}
        <p className="subtle">Log in with your Miva account to practise.</p>
        <Link href="/cliq" className="btn btn-primary">
          Log in
        </Link>
      </section>
    );
  }

  if (phase.k === "unavailable") {
    return (
      <section className="answers-page practice-page">
        {header}
        <div className="alert alert-notice">
          Practice isn&apos;t available yet. It&apos;s being switched on soon. Your study prompts on the Study page
          still work.
        </div>
        <Link href="/study" className="btn btn-ghost">
          Back to Study
        </Link>
      </section>
    );
  }

  if (phase.k === "error") {
    return (
      <section className="answers-page practice-page">
        {header}
        <p className="alert alert-error" role="alert">
          {phase.msg}
        </p>
        <div className="answer-actions">
          {course && (
            <button type="button" className="btn btn-primary" onClick={load}>
              Try again
            </button>
          )}
          <Link href="/study" className="btn btn-ghost">
            Back to Study
          </Link>
        </div>
      </section>
    );
  }

  const have = set?.questions.length ?? 0;

  if (phase.k === "needKey" || phase.k === "genError") {
    return (
      <section className="answers-page practice-page">
        {header}
        {phase.k === "genError" && (
          <p className="alert alert-error" role="alert">
            {phase.msg}
          </p>
        )}
        <div className="card practice-key-card">
          <h2 className="study-week-title">
            {phase.k === "genError" && phase.badKey
              ? "Check your Gemini key"
              : have
                ? `This week has only ${set?.bankSize ?? have} question${(set?.bankSize ?? have) === 1 ? "" : "s"} so far`
                : "No questions for this week yet"}
          </h2>
          <p className="subtle">
            {phase.k === "genError" && !phase.badKey
              ? "You can try again, or practise what's already here."
              : "Add your free Gemini key to create questions for this week. It takes about two minutes, and the questions you create are shared with everyone on this course."}
          </p>
          <div className="answer-actions">
            {phase.k === "genError" && !phase.badKey && set ? (
              <button type="button" className="btn btn-primary" onClick={() => generate(loadGeminiKey(), set)}>
                Try again
              </button>
            ) : (
              <Link href={keyHref} className="btn btn-primary">
                {phase.k === "genError" ? "Fix my key" : "Add my free key"}
              </Link>
            )}
            {have > 0 && set && (
              <button type="button" className="btn btn-ghost" onClick={() => start(set)}>
                Practise the {have} we have
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (phase.k === "generating") {
    return (
      <section className="answers-page practice-page">
        {header}
        <div className="card practice-key-card" aria-live="polite">
          <h2 className="study-week-title">Creating questions for {weekLabel}</h2>
          <div className="practice-progress-bar" role="progressbar" aria-label="Creating questions">
            <span />
          </div>
          <p className="subtle">
            {elapsed < 8
              ? "Asking Gemini with your key…"
              : elapsed < 25
                ? "Reading this week's material and writing the questions…"
                : "Almost there. Long weeks take a little longer."}{" "}
            ({elapsed}s)
          </p>
        </div>
      </section>
    );
  }

  if (phase.k === "done" && set) {
    const right = score.filter(Boolean).length;
    const total = score.length;
    return (
      <section className="answers-page practice-page">
        {header}
        <div className="card practice-end">
          <p className="practice-score">
            {right}/{total}
          </p>
          <p className="practice-end-line">
            {total && right === total
              ? "Perfect set."
              : right >= Math.ceil(total / 2)
                ? "Good work. The ones you missed will come back in a day."
                : "Keep going. The ones you missed will come back in a day so they stick."}
          </p>
          <div className="practice-end-actions">
            <button type="button" className="btn btn-primary btn-block" onClick={load}>
              Practise again
            </button>
            {set.nextWeek ? (
              <Link
                className="btn btn-ghost btn-block"
                href={`/study/practice?course=${encodeURIComponent(course)}&week=${set.nextWeek}${courseId ? `&cid=${courseId}` : ""}`}
              >
                Next week
              </Link>
            ) : (
              <Link className="btn btn-ghost btn-block" href="/study">
                Back to Study
              </Link>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (!set || !q) return null;

  return (
    <section className="answers-page practice-page">
      {header}

      <ol className="practice-steps" aria-label={`Question ${index + 1} of ${set.questions.length}`}>
        {set.questions.map((x, i) => (
          <li
            key={x.id}
            className={
              i < score.length ? (score[i] ? "is-right" : "is-wrong") : i === index ? "is-current" : ""
            }
          />
        ))}
      </ol>

      <div className="practice-card">
        <div className="answer-meta-row">
          <span className="pill pill-ghost">
            {index + 1} of {set.questions.length}
          </span>
          {q.status === "unconfirmed" && <span className="pill pill-warn">New: not yet checked by classmates</span>}
        </div>
        <p className="practice-question">{q.question}</p>

        <div className="practice-options" role="group" aria-label="Options">
          {q.options.map((o) => {
            const isRight = result && o === result.correctOption;
            const isWrongPick = result && o === chosen && !result.correct;
            return (
              <button
                key={o}
                type="button"
                className={`practice-option ${isRight ? "is-right" : ""} ${isWrongPick ? "is-wrong" : ""} ${
                  o === chosen && !result ? "is-chosen" : ""
                }`}
                disabled={!!chosen || checking}
                onClick={() => answer(o)}
              >
                {o}
              </button>
            );
          })}
        </div>

        {answerError && (
          <p className="alert alert-error" role="alert">
            {answerError}
          </p>
        )}

        <div aria-live="polite">
          {result && (
            <div className={`practice-feedback ${result.correct ? "is-right" : "is-wrong"}`}>
              <p className="practice-feedback-head">{result.correct ? "Right" : `Not quite. It's: ${result.correctOption}`}</p>
              {result.explanation && <p className="practice-feedback-why">{result.explanation}</p>}
            </div>
          )}
        </div>

        {result && (
          <button type="button" className="btn btn-primary btn-block practice-next" onClick={next}>
            {index + 1 >= set.questions.length ? "See my score" : "Next question"}
          </button>
        )}

        <button
          type="button"
          className="practice-report"
          onClick={() => report(q.id)}
          disabled={!!reported[q.id]}
        >
          {reported[q.id] === "done"
            ? "Reported. Thanks, we'll take it out if others agree."
            : reported[q.id] === "sending"
              ? "Reporting…"
              : "Report this question"}
        </button>
      </div>
    </section>
  );
}
