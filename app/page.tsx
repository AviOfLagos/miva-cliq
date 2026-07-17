"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type Screen = "login" | "choose" | "custom" | "run";

type Preset = {
  id: string;
  label: string;
  subtitle: string;
  courses: string[];
};

type Course = {
  id: number;
  fullname: string;
};

type Action =
  | "mark"
  | "skip-graded"
  | "skip-none"
  | "forum"
  | "view"
  | "unknown";

type ActivityState = string;

type PlanActivity = {
  cmid: number;
  name: string;
  modname: string;
  action: Action;
  state: ActivityState;
  url: string | null;
};

type ActivityStatus = "pending" | "done" | "skipped" | "failed" | "already";

type RunActivity = PlanActivity & {
  status: ActivityStatus;
  detail?: string; // reason, esp. for failures (e.g. "forum needs a reply")
};

type PlanCourse = {
  id: number;
  fullname: string;
  activities: PlanActivity[];
};

type RunCourse = {
  id: number;
  fullname: string;
  activities: RunActivity[];
  complete: boolean;
  summary?: RunSummary;
};

type RunSummary = {
  done: number;
  skipped: number;
  failed: number;
  already: number;
  total: number;
};

type RunMode =
  | { mode: "preset"; presetId: string }
  | { mode: "custom"; courseIds: number[] };

type LogLine = {
  id: number;
  text: string;
  tone: "info" | "good" | "warn" | "bad";
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

const LAST_RUN_KEY = "miva-cliq-last";
const HISTORY_PREFIX = "miva-cliq-history:";
const LMS_BASE = "https://lms.miva.university";

/** Deep-link to a course on the Miva LMS (opens the real dashboard). */
function mivaCourseUrl(courseId: number): string {
  return `${LMS_BASE}/course/view.php?id=${courseId}`;
}

/* ---- per-device run history (localStorage, namespaced by user email) ---- */

type HistoryCourse = {
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

type HistoryRecord = {
  at: string; // ISO timestamp
  mode: "preset" | "custom";
  courses: HistoryCourse[];
};

function historyKey(email: string): string {
  return HISTORY_PREFIX + (email || "anon").toLowerCase();
}

function loadHistory(email: string): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(historyKey(email));
    const arr = raw ? (JSON.parse(raw) as HistoryRecord[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistoryRecord(email: string, record: HistoryRecord): void {
  try {
    const list = loadHistory(email);
    list.unshift(record);
    localStorage.setItem(historyKey(email), JSON.stringify(list.slice(0, 25)));
  } catch {
    /* ignore quota / privacy mode */
  }
}

/** Latest result per course across all runs (for the "your courses" view). */
function latestPerCourse(history: HistoryRecord[]): {
  course: HistoryCourse;
  at: string;
}[] {
  const seen = new Map<number, { course: HistoryCourse; at: string }>();
  for (const rec of history) {
    for (const c of rec.courses) {
      if (!seen.has(c.id)) seen.set(c.id, { course: c, at: rec.at });
    }
  }
  return Array.from(seen.values());
}

function timeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  } catch {
    return "";
  }
}

const ACTION_META: Record<Action, { label: string; icon: string }> = {
  mark: { label: "Complete", icon: "✓" },
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

/** Robust SSE reader: parses event:/data: lines across chunk boundaries. */
async function readSSE(
  response: Response,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error("No response body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (raw: string) => {
    if (!raw.trim()) return;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      const clean = line.replace(/\r$/, "");
      if (clean.startsWith("event:")) {
        event = clean.slice(6).trim();
      } else if (clean.startsWith("data:")) {
        dataLines.push(clean.slice(5).replace(/^\s/, ""));
      }
    }
    if (dataLines.length) onEvent(event, dataLines.join("\n"));
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    // Events are separated by a blank line (\n\n).
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      flush(raw);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}

/* ------------------------------------------------------------------ */
/* Root component                                                     */
/* ------------------------------------------------------------------ */

export default function Page() {
  const [screen, setScreen] = useState<Screen>("login");
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [runMode, setRunMode] = useState<RunMode | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Called by any screen when a request returns 401 (session lapsed/missing).
  const onSessionExpired = useCallback((msg?: string) => {
    setName("");
    setRunMode(null);
    setAuthNotice(msg || "Your session expired. Please log in again.");
    setScreen("login");
  }, []);

  return (
    <main className="app">
      <div className="bg-orbs" aria-hidden="true">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </div>

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⚡
          </span>
          <span className="brand-name">Miva&nbsp;Cliq</span>
        </div>
        {screen !== "login" && name ? (
          <div className="topbar-user" title={name}>
            <span className="avatar" aria-hidden="true">
              {name.trim().charAt(0).toUpperCase() || "M"}
            </span>
            <span className="topbar-name">{name}</span>
          </div>
        ) : null}
      </header>

      <div className="stage">
        {screen === "login" && (
          <LoginScreen
            notice={authNotice}
            onSuccess={(n, mail) => {
              setAuthNotice(null);
              setName(n);
              setEmail(mail);
              setScreen("choose");
            }}
          />
        )}

        {screen === "choose" && (
          <ChooseScreen
            name={name}
            email={email}
            onCustom={() => setScreen("custom")}
            onRunPreset={(presetId) => {
              setRunMode({ mode: "preset", presetId });
              setScreen("run");
            }}
          />
        )}

        {screen === "custom" && (
          <CustomScreen
            onBack={() => setScreen("choose")}
            onSessionExpired={onSessionExpired}
            onStart={(courseIds) => {
              setRunMode({ mode: "custom", courseIds });
              setScreen("run");
            }}
          />
        )}

        {screen === "run" && runMode && (
          <RunScreen
            runMode={runMode}
            email={email}
            onSessionExpired={onSessionExpired}
            onDone={() => setScreen("choose")}
          />
        )}
      </div>

      <footer className="footer">
        <span>Miva Cliq</span>
        <span aria-hidden="true">·</span>
        <span>Your coursework, on autopilot.</span>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Login                                                              */
/* ------------------------------------------------------------------ */

function LoginScreen({
  onSuccess,
  notice,
}: {
  onSuccess: (name: string, email: string) => void;
  notice?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* ignore parse errors */
      }
      if (res.ok && data?.ok) {
        onSuccess(data.name || email.split("@")[0] || "there", email.trim());
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

        {notice && !error && (
          <div className="alert alert-notice" role="status">
            <span aria-hidden="true">🔑</span>
            <span>{notice}</span>
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

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading || !email || !password}
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
          stored after you close this.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Choose                                                             */
/* ------------------------------------------------------------------ */

function ChooseScreen({
  name,
  email,
  onCustom,
  onRunPreset,
}: {
  name: string;
  email: string;
  onCustom: () => void;
  onRunPreset: (presetId: string) => void;
}) {
  const [presets, setPresets] = useState<Preset[] | null>(null);
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

  const preset = presets?.[0] ?? null;

  return (
    <section className="fade-in choose-wrap" aria-labelledby="choose-title">
      <div className="choose-head">
        <h2 id="choose-title" className="greeting">
          Hi, {name} <span aria-hidden="true">👋</span>
        </h2>
        <p className="subtle">What would you like to run today?</p>
      </div>

      <div className="choose-grid">
        {/* Preset card */}
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

        {/* Custom card */}
        <button
          type="button"
          className="select-card"
          onClick={onCustom}
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

      {error && (
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

      {modalOpen && preset && (
        <PresetModal
          preset={preset}
          onClose={() => setModalOpen(false)}
          onConfirm={() => {
            setModalOpen(false);
            onRunPreset(preset.id);
          }}
        />
      )}
    </section>
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

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
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
  }, [onClose]);

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

function CustomScreen({
  onBack,
  onStart,
  onSessionExpired,
}: {
  onBack: () => void;
  onStart: (courseIds: number[]) => void;
  onSessionExpired: (msg?: string) => void;
}) {
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
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
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

      <div className="sticky-actions">
        <span className="selected-count">
          <strong>{selected.size}</strong> selected
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={selected.size === 0}
          onClick={() => onStart(Array.from(selected))}
        >
          Start <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Run                                                                */
/* ------------------------------------------------------------------ */

function RunScreen({
  runMode,
  email,
  onDone,
  onSessionExpired,
}: {
  runMode: RunMode;
  email: string;
  onDone: () => void;
  onSessionExpired: (msg?: string) => void;
}) {
  const [phase, setPhase] = useState<
    "planning" | "plan-error" | "running" | "finished"
  >("planning");
  const [planError, setPlanError] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [courses, setCourses] = useState<RunCourse[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null);
  const logId = useRef(0);
  const cancelled = useRef(false);

  const pushLog = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    setLogs((prev) => {
      const next = [...prev, { id: logId.current++, text, tone }];
      return next.slice(-8);
    });
  }, []);

  /* ---- overall totals ---- */
  const totals = useMemo(() => {
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

  /* ---- planning ---- */
  const doPlan = useCallback(async () => {
    setPhase("planning");
    setPlanError(null);
    cancelled.current = false;
    try {
      const body =
        runMode.mode === "preset"
          ? { presetId: runMode.presetId }
          : { courseIds: runMode.courseIds };
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
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
      setPlanError(e?.message || "Planning failed.");
      setPhase("plan-error");
    }
  }, [runMode, pushLog, onSessionExpired]);

  useEffect(() => {
    doPlan();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- apply a progress event to state ---- */
  const applyProgress = useCallback(
    (
      courseId: number,
      cmid: number,
      status: ActivityStatus,
      detail?: string,
    ) => {
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

  /* ---- run sequentially ---- */
  const runAll = useCallback(async () => {
    for (const course of courses) {
      if (cancelled.current) return;
      setActiveCourseId(course.id);
      setExpanded((prev) => new Set(prev).add(course.id));
      pushLog(`Starting: ${course.fullname}`, "info");
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ courseId: course.id }),
        });
        if (res.status === 401) {
          cancelled.current = true;
          onSessionExpired();
          return;
        }
        if (!res.ok || !res.body) {
          markCourseComplete(course.id);
          pushLog(`Could not start ${course.fullname}.`, "bad");
          continue;
        }
        await readSSE(res, (event, dataStr) => {
          if (cancelled.current) return;
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
            pushLog(
              `${course.fullname}: ${data.message || "run error"}`,
              "bad",
            );
          }
        });
      } catch {
        markCourseComplete(course.id);
        pushLog(`Error running ${course.fullname}.`, "bad");
      }
    }
    if (!cancelled.current) {
      setActiveCourseId(null);
      setPhase("finished");
    }
  }, [courses, applyProgress, markCourseComplete, pushLog, onSessionExpired]);

  // Kick off the run once we have a plan.
  const startedRef = useRef(false);
  useEffect(() => {
    if (phase === "running" && courses.length && !startedRef.current) {
      startedRef.current = true;
      runAll();
    }
  }, [phase, courses, runAll]);

  /* ---- persist run to per-device history (namespaced by user) ---- */
  const historySaved = useRef(false);
  useEffect(() => {
    if (phase !== "finished" || historySaved.current) return;
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
      localStorage.setItem(
        LAST_RUN_KEY,
        JSON.stringify({ at, ...totals }),
      );
    } catch {
      /* ignore */
    }
  }, [phase, courses, totals, email, runMode.mode]);

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pct =
    totals.total === 0
      ? 0
      : Math.round((totals.handled / totals.total) * 100);

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
              <button className="btn btn-primary" onClick={doPlan}>
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
