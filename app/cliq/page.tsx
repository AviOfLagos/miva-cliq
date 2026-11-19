"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safeNextPath } from "@/lib/http/safeNext";
import { useApp } from "@/lib/run/AppContext";
import { loadHistory, latestPerCourse } from "@/lib/run/history";
import {
  parseForumTexts,
  DEFAULT_FORUM_TEXTS,
  loadDepartment,
  saveDepartment,
} from "@/lib/run/prefs";
import { departmentsBySchool, departmentLabel, isDepartment } from "@/lib/taxonomy";
import { mivaCourseUrl, timeAgo } from "@/lib/format";
import {
  TERMS_VERSION,
  TERMS_VERSION_LABEL,
  CONSENT_STORAGE_KEY,
} from "@/lib/legal";
import type {
  Action,
  ActivityStatus,
  Course,
  HistoryRecord,
  Preset,
} from "@/lib/run/types";

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

const ACTION_META: Record<Action, { label: string; icon: string }> = {
  mark: { label: "Complete", icon: "✓" },
  quiz: { label: "Quiz · ungraded", icon: "🧠" },
  "skip-graded": { label: "Skip · graded", icon: "🎓" },
  "skip-none": { label: "Skip · manual", icon: "—" },
  forum: { label: "Forum", icon: "💬" },
  view: { label: "View", icon: "👁" },
  unknown: { label: "Unknown", icon: "?" },
};

function statusIcon(status: ActivityStatus): { icon: string; cls: string } {
  switch (status) {
    case "done":
    case "already":
      return { icon: "✓", cls: "st-good" };
    case "skipped":
      return { icon: "–", cls: "st-skip" };
    case "failed":
      return { icon: "✕", cls: "st-bad" };
    default:
      return { icon: "", cls: "st-pending" };
  }
}

/** Group a failure's reason into a human bucket, for the summary breakdown. */
function failureCategory(detail?: string): string {
  const d = (detail || "").toLowerCase();
  if (/forum|repl|announcement/.test(d)) return "Forums needing a reply";
  if (/unhandled|unknown|new strategy/.test(d)) return "Unrecognised activities";
  if (/confirm|register|stick/.test(d)) return "Didn't register";
  return "Other";
}

const CATEGORY_HINT: Record<string, string> = {
  "Forums needing a reply":
    "Add forum reply messages on the previous screen to auto-complete these.",
  "Unrecognised activities":
    "A type we don't handle yet — open it in Miva and complete it there.",
  "Didn't register":
    "The action went through but Moodle didn't mark it complete; try re-running.",
  Other: "Open these in Miva to finish them.",
};

/* ------------------------------------------------------------------ */
/* Root component                                                     */
/* ------------------------------------------------------------------ */

export default function Page() {
  const { screen } = useApp();

  return (
    <>
      {screen === "login" && <LoginScreen />}
      {screen === "choose" && <ChooseScreen />}
      {screen === "custom" && <CustomScreen />}
      {screen === "run" && <RunScreen />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Login                                                              */
/* ------------------------------------------------------------------ */

function LoginScreen() {
  const { signIn, authNotice: expiredNotice, authed, lmsConnected } = useApp();
  // Signed in through the 30-day identity, but the Miva session is gone: this
  // form is the reconnect step, so say so rather than greet them as new.
  const authNotice =
    expiredNotice ||
    (authed && !lmsConnected
      ? "You're still signed in. Reconnect to Miva to run Autopilot or load your courses."
      : null);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!agreed) {
      setError("Please accept the Terms, Privacy Policy, and Disclaimer to continue.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, agreedTerms: true }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* ignore parse errors */
      }
      if (res.ok && data?.ok) {
        // Record the accepted terms version on this device.
        try {
          localStorage.setItem(
            CONSENT_STORAGE_KEY,
            JSON.stringify({ version: TERMS_VERSION, at: new Date().toISOString() }),
          );
        } catch {
          /* ignore private-mode / quota */
        }
        signIn(data.name || email.split("@")[0] || "there", email.trim());
        // Sent here by a "Reconnect to Miva" prompt: go back to that page.
        // Same-origin only (lib/http/safeNext.ts), or it is an open redirect.
        const next = safeNextPath(
          new URLSearchParams(window.location.search).get("next"),
          window.location.origin,
        );
        if (next) router.push(next);
      } else {
        setError(data?.error || "We couldn't log you in. Check your details and try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="fade-in center-wrap" aria-labelledby="login-title">
      <div className="card login-card">
        <div className="login-hero">
          <span className="login-glyph" aria-hidden="true">
            ⚡
          </span>
          <h1 id="login-title" className="login-title">
            Miva Cliq
          </h1>
          <p className="login-tagline">
            Auto-complete your Miva coursework in minutes, not hours.
          </p>
        </div>

        {/* Handing over an LMS password is the moment people hesitate — answer
            the three obvious worries right here, not buried on another page. */}
        <ul className="trust-strip" aria-label="What Miva Cliq does and doesn't do">
          <li className="pill pill-ghost">🎓 Graded tests never touched</li>
          <li className="pill pill-ghost">🔒 Password never stored</li>
          <li className="pill pill-ghost">✓ Every completion verified</li>
        </ul>

        {authNotice && !error && (
          <div className="alert alert-notice" role="status">
            <span aria-hidden="true">🔑</span>
            <span>{authNotice}</span>
          </div>
        )}

        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="you@miva.edu.ng"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="pw-wrap">
              <input
                id="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
                disabled={loading}
              >
                {showPw ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <span aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <label className="consent-check">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={loading}
              aria-describedby="consent-text"
            />
            <span className="consent-box" aria-hidden="true">
              {agreed ? "✓" : ""}
            </span>
            <span id="consent-text" className="consent-text">
              I have read and agree to the{" "}
              <Link className="miva-link" href="/terms">
                Terms
              </Link>
              ,{" "}
              <Link className="miva-link" href="/privacy">
                Privacy Policy
              </Link>
              , and{" "}
              <Link className="miva-link" href="/disclaimer">
                Disclaimer
              </Link>{" "}
              ({TERMS_VERSION_LABEL}), and I understand I use Miva Cliq entirely
              at my own risk.
            </span>
          </label>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading || !email || !password || !agreed}
          >
            {loading ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Logging in…
              </>
            ) : (
              "Log in"
            )}
          </button>
        </form>

        <p className="reassure">
          🔒 Your login is used only to complete your own coursework. Nothing is
          stored after you close this.{" "}
          <Link className="miva-link" href="/how-it-works">
            How it works
          </Link>
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Choose                                                             */
/* ------------------------------------------------------------------ */

function ChooseScreen() {
  const { name, email, setScreen, startRun, onSessionExpired } = useApp();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [department, setDepartment] = useState("");
  const [autoOpen, setAutoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    setHistory(loadHistory(email));
  }, [email]);

  const recentCourses = useMemo(() => latestPerCourse(history), [history]);

  const loadPresets = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/presets", { credentials: "include" });
      const data = await res.json();
      const list: Preset[] = Array.isArray(data)
        ? data
        : data?.presets ?? (data?.id ? [data] : []);
      setPresets(list);
    } catch {
      setError("Couldn't load presets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  // Detect level/semester from this semester's courses. GET is read-only (the
  // stored department only selects package notes); confirming a department is
  // a POST, which is what records the curriculum.
  const loadProfile = useCallback(
    async (dept: string, confirm = false) => {
      try {
        const res = confirm
          ? await fetch("/api/profile", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ department: dept }),
            })
          : await fetch(
              `/api/profile${dept ? `?department=${encodeURIComponent(dept)}` : ""}`,
              { credentials: "include" },
            );
        if (res.status === 401) {
          onSessionExpired();
          return;
        }
        const data = await res.json().catch(() => null);
        // A failed refresh keeps what we had; with nothing, the preset is the fallback.
        if (res.ok && data) setProfile(data as Profile);
      } catch {
        /* keep the previous profile, if any */
      } finally {
        setProfileLoading(false);
      }
    },
    [onSessionExpired],
  );

  useEffect(() => {
    const stored = loadDepartment(email);
    const dept = isDepartment(stored) ? stored : "";
    setDepartment(dept);
    loadProfile(dept);
  }, [email, loadProfile]);

  const confirmDepartment = (slug: string) => {
    if (!isDepartment(slug)) return;
    saveDepartment(email, slug);
    setDepartment(slug);
    loadProfile(slug, true);
  };

  const preset = presets?.[0] ?? null;
  const detected =
    profile && profile.level && profile.selectedIds.length > 0 ? profile : null;
  // The old preset only appears when detection found nothing.
  const showPreset = !profileLoading && !detected;

  return (
    <section className="fade-in choose-wrap" aria-labelledby="choose-title">
      <div className="choose-head">
        <h2 id="choose-title" className="greeting">
          Hi, {name} <span aria-hidden="true">👋</span>
        </h2>
        <p className="subtle">
          What would you like to run today?{" "}
          <Link className="miva-link" href="/how-it-works">
            How it works
          </Link>
        </p>
      </div>

      <div className="choose-grid">
        {/* Your courses this semester (detected) */}
        {!showPreset && (
          <button
            type="button"
            className="select-card"
            onClick={() => detected && setAutoOpen(true)}
            disabled={!detected}
            aria-label={
              detected
                ? `Your courses this semester: ${profileSummary(detected)}`
                : "Detecting your courses"
            }
          >
            <div className="select-card-top">
              <span className="badge badge-preset">THIS SEMESTER</span>
              <span className="card-emoji" aria-hidden="true">
                🎯
              </span>
            </div>
            {!detected ? (
              <div className="skeleton-lines">
                <span className="skeleton w-70" />
                <span className="skeleton w-40" />
              </div>
            ) : (
              <>
                <h3 className="select-card-title">Your courses this semester</h3>
                <p className="select-card-sub">{profileSummary(detected)}</p>
                <div className="select-card-foot">
                  <span className="pill">
                    {detected.selectedIds.length}{" "}
                    {detected.selectedIds.length === 1 ? "course" : "courses"}
                  </span>
                  <span className="go-hint">
                    Review <span aria-hidden="true">→</span>
                  </span>
                </div>
              </>
            )}
          </button>
        )}

        {/* Preset card: fallback when detection finds nothing */}
        {showPreset && (
        <button
          type="button"
          className="select-card"
          onClick={() => preset && setModalOpen(true)}
          disabled={!preset}
          aria-label={
            preset
              ? `Preset: ${preset.label}, ${preset.subtitle}`
              : "Preset loading"
          }
        >
          <div className="select-card-top">
            <span className="badge badge-preset">PRESET</span>
            <span className="card-emoji" aria-hidden="true">
              🎯
            </span>
          </div>
          {loading ? (
            <div className="skeleton-lines">
              <span className="skeleton w-70" />
              <span className="skeleton w-40" />
            </div>
          ) : preset ? (
            <>
              <h3 className="select-card-title">{preset.label}</h3>
              <p className="select-card-sub">{preset.subtitle}</p>
              <div className="select-card-foot">
                <span className="pill">
                  {preset.courses.length}{" "}
                  {preset.courses.length === 1 ? "course" : "courses"}
                </span>
                <span className="go-hint">
                  Preview <span aria-hidden="true">→</span>
                </span>
              </div>
            </>
          ) : (
            <p className="select-card-sub">No preset available.</p>
          )}
        </button>
        )}

        {/* Custom card */}
        <button
          type="button"
          className="select-card"
          onClick={() => setScreen("custom")}
          aria-label="Custom: pick your own courses"
        >
          <div className="select-card-top">
            <span className="badge badge-custom">CUSTOM</span>
            <span className="card-emoji" aria-hidden="true">
              🧩
            </span>
          </div>
          <h3 className="select-card-title">Pick your own courses</h3>
          <p className="select-card-sub">Choose exactly what to run.</p>
          <div className="select-card-foot">
            <span className="pill pill-ghost">Your enrolled courses</span>
            <span className="go-hint">
              Choose <span aria-hidden="true">→</span>
            </span>
          </div>
        </button>
      </div>

      {showPreset && error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={loadPresets}>
            Retry
          </button>
        </div>
      )}

      {recentCourses.length > 0 && (
        <div className="history">
          <div className="history-head">
            <h3 className="history-title">Your courses</h3>
            <span className="subtle">
              Saved on this device · tap a course to open it in Miva
            </span>
          </div>
          <div className="history-grid">
            {recentCourses.map(({ course, at }) => {
              const completed = course.done + course.already;
              return (
                <a
                  key={course.id}
                  className="history-card"
                  href={mivaCourseUrl(course.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${course.fullname} in Miva`}
                >
                  <div className="history-card-top">
                    <span className="history-course">{course.fullname}</span>
                    <span className="ext" aria-hidden="true">
                      ↗
                    </span>
                  </div>
                  <div className="progress-track" aria-hidden="true">
                    <div
                      className="progress-fill fill-done"
                      style={{ width: `${course.pct}%` }}
                    />
                  </div>
                  <div className="history-card-foot">
                    <span className="history-pct">{course.pct}%</span>
                    <span className="subtle">
                      {completed}/{course.total} done
                      {course.failed ? ` · ${course.failed} failed` : ""}
                    </span>
                    <span className="subtle history-when">{timeAgo(at)}</span>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      <ForumTextsEditor />
      <QuizToggle />

      {autoOpen && detected && (
        <AutoModal
          profile={detected}
          department={department}
          onConfirmDepartment={confirmDepartment}
          onClose={() => setAutoOpen(false)}
          onStart={(courseIds) => {
            setAutoOpen(false);
            startRun({ mode: "custom", courseIds });
          }}
        />
      )}

      {modalOpen && preset && (
        <PresetModal
          preset={preset}
          onClose={() => setModalOpen(false)}
          onConfirm={() => {
            setModalOpen(false);
            startRun({ mode: "preset", presetId: preset.id });
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Forum reply texts editor                                           */
/* ------------------------------------------------------------------ */

function ForumTextsEditor() {
  const { forumTexts, setForumTexts } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  // Sync the textarea from context whenever the panel opens.
  useEffect(() => {
    if (open) setDraft(forumTexts.join("\n"));
  }, [open, forumTexts]);

  const count = forumTexts.length;

  const save = () => {
    const parsed = parseForumTexts(draft);
    setForumTexts(parsed);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="forum-editor">
      <button
        type="button"
        className="forum-editor-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`chevron ${open ? "open" : ""}`} aria-hidden="true">
          ▸
        </span>
        <span className="forum-editor-title">
          💬 Forum reply messages
        </span>
        <span className="forum-editor-meta">
          <span className="pill pill-ghost">
            {count} {count === 1 ? "message" : "messages"}
          </span>
        </span>
      </button>

      {open && (
        <div className="forum-editor-body">
          <p className="subtle">
            Some forums only complete once you post a reply. Add a few messages
            below — one per line — and we&apos;ll post a random one to each of
            those forums. Keep them relevant and appropriate; they&apos;re
            visible to your class.
          </p>
          <textarea
            className="forum-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder="One reply message per line…"
            aria-label="Forum reply messages, one per line"
          />
          <div className="forum-editor-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDraft(DEFAULT_FORUM_TEXTS.join("\n"))}
            >
              Reset to defaults
            </button>
            <span className="grow" />
            {saved && <span className="saved-note">Saved ✓</span>}
            <button type="button" className="btn btn-primary btn-sm" onClick={save}>
              Save messages
            </button>
          </div>
          <p className="forum-editor-hint subtle">
            Leave this empty to skip forum posting — those forums will just be
            reported as needing a manual reply.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ungraded-quiz opt-in toggle                                        */
/* ------------------------------------------------------------------ */

function QuizToggle() {
  const { answerQuizzes, setAnswerQuizzes } = useApp();
  return (
    <div className="quiz-toggle">
      <label className="quiz-toggle-row">
        <input
          type="checkbox"
          checked={answerQuizzes}
          onChange={(e) => setAnswerQuizzes(e.target.checked)}
        />
        <span className="quiz-toggle-text">
          <span className="quiz-toggle-title">🧠 Attempt ungraded weekly quizzes</span>
          <span className="subtle">
            Off by default. When on, we attempt <strong>ungraded</strong>,
            multiple-choice quizzes using AI and a shared answer bank that fills in
            as students take them. Graded tests and exams are never touched, and
            non-multiple-choice questions are left blank.
          </span>
        </span>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal focus trap (shared by the preset and this-semester modals)   */
/* ------------------------------------------------------------------ */

function useModalTrap(
  dialogRef: RefObject<HTMLDivElement>,
  initialFocusRef: RefObject<HTMLElement>,
  onClose: () => void,
) {
  // Callers pass inline closures; a ref keeps a parent re-render from
  // re-running the effect and yanking focus back to the initial button.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    initialFocusRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [dialogRef, initialFocusRef]);
}

/* ------------------------------------------------------------------ */
/* "Your courses this semester" (detected level, pre-selected)        */
/* ------------------------------------------------------------------ */

/** Shape of GET /api/profile. */
type Profile = {
  level: number | null;
  semester: "first" | "second" | null;
  department: string | null;
  departmentSource: "override" | "courses" | "none";
  courses: { id: number; fullname: string; code: string | null; level: number | null }[];
  selectedIds: number[];
  notes: string[];
};

const DEPT_GROUPS = departmentsBySchool();

function profileSummary(p: Profile): string {
  const parts = [`${p.level} level`];
  if (p.semester) parts.push(p.semester === "first" ? "First semester" : "Second semester");
  return parts.join(" · ");
}

function AutoModal({
  profile,
  department,
  onConfirmDepartment,
  onClose,
  onStart,
}: {
  profile: Profile;
  /** Confirmed slug from localStorage, or "" if never confirmed. */
  department: string;
  onConfirmDepartment: (slug: string) => void;
  onClose: () => void;
  onStart: (courseIds: number[]) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  useModalTrap(dialogRef, startRef, onClose);

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(profile.selectedIds),
  );
  const [editingDept, setEditingDept] = useState(!department);
  const [draftDept, setDraftDept] = useState(department || profile.department || "");

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Pre-selected (detected level) first, then carry-overs and uncoded courses.
  const ordered = useMemo(() => {
    const pre = new Set(profile.selectedIds);
    return [
      ...profile.courses.filter((c) => pre.has(c.id)),
      ...profile.courses.filter((c) => !pre.has(c.id)),
    ];
  }, [profile]);

  return (
    <div
      className="modal-backdrop fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal pop-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-modal-title"
        ref={dialogRef}
      >
        <div className="modal-head">
          <div>
            <span className="badge badge-preset">THIS SEMESTER</span>
            <h3 id="auto-modal-title" className="modal-title">
              Your courses this semester
            </h3>
            <p className="modal-sub">
              {profileSummary(profile)}
              {department ? ` · ${departmentLabel(department)}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close course preview"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {editingDept ? (
            <div className="composer-fields">
              <label className="composer-field">
                <span className="composer-label">Confirm your department</span>
                <select
                  value={draftDept}
                  onChange={(e) => setDraftDept(e.target.value)}
                >
                  <option value="">— choose —</option>
                  {DEPT_GROUPS.map((g) => (
                    <optgroup key={g.school} label={g.school}>
                      {g.items.map((d) => (
                        <option key={d.slug} value={d.slug}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="subtle">
                  {profile.department && !department
                    ? "Guessed from your course codes. Confirm once and we'll remember it on this device."
                    : "Asked once, remembered on this device."}
                </span>
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!draftDept}
                onClick={() => {
                  onConfirmDepartment(draftDept);
                  setEditingDept(false);
                }}
              >
                Confirm
              </button>
            </div>
          ) : (
            <p className="modal-count">
              {departmentLabel(department)}{" "}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditingDept(true)}
              >
                Change
              </button>
            </p>
          )}

          <p className="modal-count">
            {selected.size} of {profile.courses.length} selected
          </p>
          <ul className="checklist" role="group" aria-label="This semester's courses">
            {ordered.map((c) => {
              const checked = selected.has(c.id);
              return (
                <li key={c.id}>
                  <label className={`check-row ${checked ? "is-checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="checkbox" aria-hidden="true">
                      {checked ? "✓" : ""}
                    </span>
                    <span className="check-label">{c.fullname}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          {/* Package courses they aren't enrolled in: a note, never runnable. */}
          {department && profile.notes.length > 0 && (
            <div className="alert alert-notice" role="note">
              <span aria-hidden="true">ℹ️</span>
              <span>
                {profile.notes.join(" ")} We can only run courses you&apos;re
                enrolled in.
              </span>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onStart(Array.from(selected))}
            disabled={selected.size === 0}
            ref={startRef}
          >
            Start <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preset modal (focus trapped)                                       */
/* ------------------------------------------------------------------ */

function PresetModal({
  preset,
  onClose,
  onConfirm,
}: {
  preset: Preset;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useModalTrap(dialogRef, confirmRef, onClose);

  return (
    <div
      className="modal-backdrop fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal pop-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-modal-title"
        ref={dialogRef}
      >
        <div className="modal-head">
          <div>
            <span className="badge badge-preset">PRESET</span>
            <h3 id="preset-modal-title" className="modal-title">
              {preset.label}
            </h3>
            <p className="modal-sub">{preset.subtitle}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close preset preview"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-count">
            {preset.courses.length} courses included
          </p>
          <ul className="course-list">
            {preset.courses.map((c, i) => (
              <li key={i} className="course-list-item">
                <span className="course-idx" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="course-name">{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            ref={confirmRef}
          >
            Go with this preset <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Custom (searchable multi-select)                                   */
/* ------------------------------------------------------------------ */

function CustomScreen() {
  const { setScreen, startRun, onSessionExpired } = useApp();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/courses", { credentials: "include" });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't load your courses.");
        setCourses([]);
        return;
      }
      setCourses(Array.isArray(data?.courses) ? data.courses : []);
    } catch {
      setError("Network error — couldn't load your courses.");
      setCourses([]);
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!courses) return [];
    if (!q) return courses;
    return courses.filter((c) => c.fullname.toLowerCase().includes(q));
  }, [courses, query]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((c) => next.delete(c.id));
      } else {
        filtered.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  return (
    <section className="fade-in custom-wrap" aria-labelledby="custom-title">
      <div className="section-head">
        <button className="btn btn-ghost btn-sm" onClick={() => setScreen("choose")}>
          <span aria-hidden="true">←</span> Back
        </button>
        <div>
          <h2 id="custom-title" className="section-title">
            Pick your courses
          </h2>
          <p className="subtle">Search and select what you want to run.</p>
        </div>
      </div>

      <div className="card custom-card">
        <div className="custom-toolbar">
          <div className="search">
            <span className="search-icon" aria-hidden="true">
              🔎
            </span>
            <input
              type="search"
              placeholder="Search your courses…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search courses"
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={toggleAllVisible}
            disabled={filtered.length === 0}
          >
            {allVisibleSelected ? "Clear shown" : "Select shown"}
          </button>
        </div>

        {loading ? (
          <div className="checklist">
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="skeleton-row" key={i}>
                <span className="skeleton box" />
                <span className="skeleton w-70" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="alert alert-error" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={load}>
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <span aria-hidden="true">🗂️</span>
            <p>{query ? "No courses match your search." : "No courses found."}</p>
          </div>
        ) : (
          <ul className="checklist" role="group" aria-label="Your courses">
            {filtered.map((c) => {
              const checked = selected.has(c.id);
              return (
                <li key={c.id}>
                  <label className={`check-row ${checked ? "is-checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="checkbox" aria-hidden="true">
                      {checked ? "✓" : ""}
                    </span>
                    <span className="check-label">{c.fullname}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <QuizToggle />

      <div className="sticky-actions">
        <span className="selected-count">
          <strong>{selected.size}</strong> selected
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={selected.size === 0}
          onClick={() => startRun({ mode: "custom", courseIds: Array.from(selected) })}
        >
          Start <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Run — pure view over AppContext (the run loop itself lives in the   */
/* provider so it survives navigating to /gists etc.)                  */
/* ------------------------------------------------------------------ */

function RunScreen() {
  const {
    phase,
    planError,
    unmatched,
    courses,
    logs,
    activeCourseId,
    expanded,
    totals,
    pct,
    setScreen,
    retryPlan,
    toggleExpand,
  } = useApp();

  const onDone = () => setScreen("choose");

  /* ---- planning / error states ---- */
  if (phase === "planning") {
    return (
      <section className="fade-in center-wrap" aria-live="polite">
        <div className="card plan-loading">
          <span className="spinner spinner-lg" aria-hidden="true" />
          <h2 className="section-title">Building your plan…</h2>
          <p className="subtle">
            Scanning your courses and mapping out what to complete.
          </p>
        </div>
      </section>
    );
  }

  if (phase === "plan-error") {
    return (
      <section className="fade-in center-wrap">
        <div className="card">
          <div className="empty">
            <span aria-hidden="true">😕</span>
            <h2 className="section-title">Couldn't build your plan</h2>
            <p className="subtle">{planError}</p>
            <div className="row-actions">
              <button className="btn btn-ghost" onClick={onDone}>
                Back
              </button>
              <button className="btn btn-primary" onClick={retryPlan}>
                Retry
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const failures = courses.flatMap((c) =>
    c.activities
      .filter((a) => a.status === "failed")
      .map((a) => ({
        course: c.fullname,
        activity: a.name,
        detail: a.detail,
        url: a.url,
      })),
  );

  // Group failures by reason so the biggest drag on the success rate is obvious.
  const failureBreakdown = Object.entries(
    failures.reduce<Record<string, number>>((acc, f) => {
      const cat = failureCategory(f.detail);
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <section className="fade-in run-wrap">
      <div className="section-head run-head">
        <div>
          <h2 className="section-title">
            {phase === "finished" ? "All done" : "Running your coursework"}
          </h2>
          <p className="subtle">
            {phase === "finished"
              ? "Here's how it went."
              : "Sit back — we'll keep you posted."}
          </p>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div className="alert alert-notice" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>
            {unmatched.length} preset course
            {unmatched.length === 1 ? "" : "s"} weren&apos;t found in your
            account and were skipped: {unmatched.join(", ")}.
          </span>
        </div>
      )}

      <div className="run-top">
        {/* Progress ring */}
        <div className="card ring-card">
          <ProgressRing
            percent={pct}
            done={phase === "finished"}
            hasFailures={totals.failed > 0}
          />
          <div className="ring-stats">
            <p className="ring-count">
              <strong>{totals.handled}</strong> / {totals.total}
            </p>
            <p className="subtle">activities processed</p>
            <div className="stat-chips">
              <span className="chip chip-good">✓ {totals.done + totals.already} done</span>
              <span className="chip chip-warn">– {totals.skipped} skipped</span>
              {totals.failed > 0 && (
                <span className="chip chip-bad">✕ {totals.failed} failed</span>
              )}
            </div>
          </div>
        </div>

        {/* Live log */}
        <div className="card log-card" aria-live="polite" aria-label="Activity log">
          <div className="log-head">
            <span className="live-dot" aria-hidden="true" />
            <span>Live activity</span>
          </div>
          <ul className="log-list">
            {logs.length === 0 ? (
              <li className="log-line log-info">Warming up…</li>
            ) : (
              logs.map((l) => (
                <li key={l.id} className={`log-line log-${l.tone}`}>
                  {l.text}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {/* Course rows */}
      <div className="course-rows">
        {courses.map((c) => {
          const total = c.activities.length;
          const handled = c.activities.filter(
            (a) => a.status !== "pending",
          ).length;
          const cpct = total === 0 ? 0 : Math.round((handled / total) * 100);
          const isOpen = expanded.has(c.id);
          const isActive = activeCourseId === c.id;
          return (
            <div
              key={c.id}
              className={`card course-row ${isActive ? "is-active" : ""} ${
                c.complete ? "is-complete" : ""
              }`}
            >
              <div className="course-row-bar">
                <button
                  type="button"
                  className="course-row-head"
                  onClick={() => toggleExpand(c.id)}
                  aria-expanded={isOpen}
                >
                  <span className={`chevron ${isOpen ? "open" : ""}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="course-row-title">{c.fullname}</span>
                  <span className="course-row-meta">
                    {c.complete ? (
                      <span className="tag tag-done">Done</span>
                    ) : isActive ? (
                      <span className="tag tag-active">
                        <span className="spinner spinner-sm" aria-hidden="true" />
                        Running
                      </span>
                    ) : (
                      <span className="tag">Queued</span>
                    )}
                    <span className="count-badge">
                      {handled}/{total}
                    </span>
                  </span>
                </button>
                <a
                  className="miva-link"
                  href={mivaCourseUrl(c.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${c.fullname} in Miva`}
                >
                  Miva <span aria-hidden="true">↗</span>
                </a>
              </div>

              <div className="progress-track" aria-hidden="true">
                <div
                  className={`progress-fill ${c.complete ? "fill-done" : ""}`}
                  style={{ width: `${cpct}%` }}
                />
              </div>

              {isOpen && (
                <ul className="activity-list">
                  {c.activities.length === 0 ? (
                    <li className="activity-empty">No activities planned.</li>
                  ) : (
                    c.activities.map((a) => {
                      const s = statusIcon(a.status);
                      const meta = ACTION_META[a.action] ?? ACTION_META.unknown;
                      return (
                        <li key={a.cmid} className="activity-item">
                          <span className={`status-dot ${s.cls}`} aria-hidden="true">
                            {s.icon}
                          </span>
                          {a.url ? (
                            <a
                              className="activity-name activity-link"
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open "${a.name}" in Miva`}
                            >
                              {a.name} <span className="ext" aria-hidden="true">↗</span>
                            </a>
                          ) : (
                            <span className="activity-name">{a.name}</span>
                          )}
                          <span className="activity-tags">
                            <span className="mini-tag" title={meta.label}>
                              {meta.icon} {meta.label}
                            </span>
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {phase === "finished" && (
        <div className="card summary-card pop-in">
          <div className="summary-hero">
            <span className="summary-emoji" aria-hidden="true">
              {totals.failed === 0 ? "🎉" : "✅"}
            </span>
            <h2 className="summary-title">
              {totals.failed === 0
                ? "Coursework complete!"
                : "Finished with a few misses"}
            </h2>
            <p className="subtle">
              {totals.done + totals.already} completed
              {totals.skipped ? `, ${totals.skipped} skipped` : ""}
              {totals.failed ? `, ${totals.failed} failed` : ""}.
            </p>
          </div>

          <div className="summary-stats">
            <div className="summary-stat">
              <span className="summary-num text-good">
                {totals.done + totals.already}
              </span>
              <span className="summary-label">Done</span>
            </div>
            <div className="summary-stat">
              <span className="summary-num text-warn">{totals.skipped}</span>
              <span className="summary-label">Skipped</span>
            </div>
            <div className="summary-stat">
              <span className="summary-num text-bad">{totals.failed}</span>
              <span className="summary-label">Failed</span>
            </div>
          </div>

          {failures.length > 0 && (
            <div className="failures">
              <h3 className="failures-title">Needs another look</h3>

              {failureBreakdown.length > 0 && (
                <ul className="fail-breakdown">
                  {failureBreakdown.map(([cat, n]) => (
                    <li key={cat} className="fail-cat">
                      <span className="fail-cat-count">{n}</span>
                      <span className="fail-cat-name">{cat}</span>
                      <span className="fail-cat-hint subtle">
                        {CATEGORY_HINT[cat]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <ul className="failures-list">
                {failures.map((f, i) => (
                  <li key={i}>
                    <span className="fail-x" aria-hidden="true">
                      ✕
                    </span>
                    <span>
                      {f.url ? (
                        <a
                          className="activity-link"
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <strong>{f.activity}</strong>{" "}
                          <span className="ext" aria-hidden="true">
                            ↗
                          </span>
                        </a>
                      ) : (
                        <strong>{f.activity}</strong>
                      )}
                      <span className="subtle"> — {f.course}</span>
                      {f.detail ? (
                        <span className="fail-reason">{f.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="btn btn-primary btn-block" onClick={onDone}>
            Run again
          </button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Progress ring (SVG)                                                */
/* ------------------------------------------------------------------ */

function ProgressRing({
  percent,
  done,
  hasFailures,
}: {
  percent: number;
  done: boolean;
  hasFailures: boolean;
}) {
  const size = 148;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  return (
    <div className="ring" role="img" aria-label={`${percent}% complete`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="55%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#2dd4bf" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-bg"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ring-fg"
        />
      </svg>
      <div className="ring-center">
        {done ? (
          <span className={`ring-check ${hasFailures ? "warn" : ""}`}>
            {hasFailures ? "!" : "✓"}
          </span>
        ) : (
          <span className="ring-pct">{percent}%</span>
        )}
      </div>
    </div>
  );
}