"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/run/AppContext";
import { departmentLabel, departmentsBySchool } from "@/lib/taxonomy";

type MivaEvent = {
  id: string;
  title: string;
  body: string;
  startsAt: number;
  location: string | null;
  link: string | null;
  department: string | null;
  createdAt: number;
};

const MAX_TITLE = 140;
const DEPT_GROUPS = departmentsBySchool();

function whenLabel(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EventsClient() {
  const { name } = useApp();
  const [events, setEvents] = useState<MivaEvent[] | null>(null);
  const [past, setPast] = useState<MivaEvent[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
      setEnabled(data.enabled !== false);
    } catch {
      setError("Couldn't load events.");
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadPast = async () => {
    setShowPast(true);
    if (past !== null) return;
    try {
      const res = await fetch("/api/events?past=1");
      const data = await res.json();
      setPast(Array.isArray(data.events) ? data.events : []);
    } catch {
      setPast([]);
    }
  };

  const onPosted = (ev: MivaEvent) =>
    setEvents((prev) => {
      const next = [...(prev ?? []), ev];
      next.sort((a, b) => a.startsAt - b.startsAt);
      return next;
    });

  return (
    <section className="fade-in doc-wrap" aria-labelledby="events-title">
      <div className="doc-head">
        <div className="board-tabs" role="tablist" aria-label="Boards">
          <Link className="board-tab" href="/gists">
            Gists
          </Link>
          <span className="board-tab is-current">Events</span>
        </div>
        <h1 id="events-title" className="section-title">
          Miva Events
        </h1>
        <p className="subtle">
          Study groups, meetups, deadlines — posted by students, for students.
        </p>
      </div>

      {!enabled && (
        <div className="alert alert-notice" role="status">
          <span aria-hidden="true">🔌</span>
          <span>Events isn&apos;t configured on this deployment yet.</span>
        </div>
      )}

      {enabled &&
        (name ? (
          <EventComposer onPosted={onPosted} />
        ) : (
          <div className="card doc-card gist-login">
            <p className="doc-body">
              Log in to post an event. Posts are anonymous.
            </p>
            <Link className="btn btn-primary btn-sm" href="/cliq">
              Log in
            </Link>
          </div>
        ))}

      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={load}>
            Retry
          </button>
        </div>
      )}

      <h2 className="events-heading">Upcoming</h2>
      {events === null ? (
        <div className="card doc-card">
          <div className="skeleton-lines">
            <span className="skeleton w-70" />
            <span className="skeleton w-40" />
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="card doc-card">
          <div className="empty">
            <span aria-hidden="true">📅</span>
            <p>Nothing coming up. Post the first event.</p>
          </div>
        </div>
      ) : (
        <div className="gist-feed">
          {events.map((ev) => (
            <EventCard key={ev.id} event={ev} canPost={!!name} />
          ))}
        </div>
      )}

      <div className="doc-foot">
        {!showPast ? (
          <button className="btn btn-ghost btn-sm" onClick={loadPast}>
            Show past events
          </button>
        ) : past && past.length > 0 ? (
          <div className="events-past">
            <h2 className="events-heading">Past</h2>
            <div className="gist-feed">
              {past.map((ev) => (
                <EventCard key={ev.id} event={ev} canPost={!!name} isPast />
              ))}
            </div>
          </div>
        ) : (
          <p className="subtle">No past events.</p>
        )}
      </div>
    </section>
  );
}

function EventCard({
  event,
  canPost,
  isPast,
}: {
  event: MivaEvent;
  canPost: boolean;
  isPast?: boolean;
}) {
  const [reported, setReported] = useState(false);
  const report = async () => {
    setReported(true);
    try {
      await fetch(`/api/events/${event.id}/report`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* best-effort */
    }
  };

  return (
    <article className={`card gist-card event-card ${isPast ? "is-past" : ""}`}>
      <Link href={`/events/${event.id}`} className="gist-card-link">
        <div className="event-when">{whenLabel(event.startsAt)}</div>
        <h3 className="event-title">{event.title}</h3>
        {event.body && <p className="gist-body gist-body-clamp">{event.body}</p>}
      </Link>
      <div className="event-details">
        {event.location && (
          <span className="event-detail">📍 {event.location}</span>
        )}
        {event.link && (
          <a
            className="miva-link"
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            🔗 Link <span aria-hidden="true">↗</span>
          </a>
        )}
        {event.department && (
          <span className="gist-tag gist-tag-dept">
            {departmentLabel(event.department)}
          </span>
        )}
      </div>
      <div className="gist-actions">
        <span className="gist-author">Anonymous</span>
        {canPost && !isPast && (
          <button
            type="button"
            className="gist-action"
            onClick={report}
            disabled={reported}
          >
            {reported ? "Reported" : "Report"}
          </button>
        )}
      </div>
    </article>
  );
}

function EventComposer({ onPosted }: { onPosted: (e: MivaEvent) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [location, setLocation] = useState("");
  const [link, setLink] = useState("");
  const [department, setDepartment] = useState("");
  const [open, setOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (posting || !title.trim() || !startsAt) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          body: body || undefined,
          // datetime-local is local wall-clock; toISOString normalizes to UTC.
          startsAt: new Date(startsAt).toISOString(),
          location: location || undefined,
          link: link || undefined,
          department: department || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't post that.");
        return;
      }
      onPosted(data.event);
      setTitle("");
      setBody("");
      setStartsAt("");
      setLocation("");
      setLink("");
      setDepartment("");
      setOpen(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPosting(false);
    }
  };

  if (!open) {
    return (
      <button className="btn btn-primary btn-sm event-add" onClick={() => setOpen(true)}>
        + Post an event
      </button>
    );
  }

  return (
    <form className="card doc-card gist-composer" onSubmit={submit}>
      <label className="composer-field">
        <span className="composer-label">Title</span>
        <input
          type="text"
          placeholder="e.g. CS study group"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE}
          disabled={posting}
        />
      </label>

      <div className="composer-fields">
        <label className="composer-field">
          <span className="composer-label">When</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            disabled={posting}
          />
        </label>
        <label className="composer-field">
          <span className="composer-label">Location (optional)</span>
          <input
            type="text"
            placeholder="Library, Zoom…"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={posting}
          />
        </label>
      </div>

      <label className="composer-field">
        <span className="composer-label">Link (optional)</span>
        <input
          type="url"
          placeholder="https://…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          disabled={posting}
        />
      </label>

      <label className="composer-field">
        <span className="composer-label">Details (optional)</span>
        <textarea
          className="gist-textarea"
          rows={2}
          placeholder="Anything else people should know."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={posting}
        />
      </label>

      <label className="composer-field">
        <span className="composer-label">Department (optional)</span>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          disabled={posting}
        >
          <option value="">— none —</option>
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
      </label>

      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </div>
      )}
      <div className="gist-composer-foot">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen(false)}
          disabled={posting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={posting || !title.trim() || !startsAt}
        >
          {posting ? "Posting…" : "Post event"}
        </button>
      </div>
    </form>
  );
}