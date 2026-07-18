"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/run/AppContext";
import { timeAgo } from "@/lib/format";
import IdentityToggle from "@/app/components/IdentityToggle";
import AuthorLabel from "@/app/components/AuthorLabel";
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
  editedAt: number | null;
  authorName: string | null;
};

const MAX_TITLE = 140;
const DEPT_GROUPS = departmentsBySchool();

function whenLabel(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** <input type="datetime-local"> wants local wall-clock "YYYY-MM-DDTHH:mm". */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function EventDetail({ initialEvent }: { initialEvent: MivaEvent }) {
  const { name } = useApp();
  const router = useRouter();
  const [event, setEvent] = useState<MivaEvent>(initialEvent);
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${initialEvent.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.event) setEvent(data.event);
      setMine(!!data.mine);
    } catch {
      /* keep server-rendered copy */
    }
  }, [initialEvent.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = async () => {
    if (!confirm("Delete this event? This can't be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        router.push("/events");
        return;
      }
    } catch {
      /* fall through */
    }
    setDeleting(false);
  };

  const isPast = event.startsAt < Date.now();

  return (
    <section className="fade-in doc-wrap">
      <div className="doc-head">
        <Link className="miva-link" href="/events">
          <span aria-hidden="true">←</span> All events
        </Link>
      </div>

      {editing ? (
        <EventEditor
          event={event}
          onCancel={() => setEditing(false)}
          onSaved={(ev) => {
            setEvent(ev);
            setEditing(false);
          }}
        />
      ) : (
        <article className={`card gist-card event-card ${isPast ? "is-past" : ""}`}>
          <div className="event-when">{whenLabel(event.startsAt)}</div>
          <h1 className="event-title event-title-lg">{event.title}</h1>
          {event.body && <p className="gist-body">{event.body}</p>}
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
          <div className="gist-meta event-posted">
            <AuthorLabel name={event.authorName} />
            <span aria-hidden="true">·</span>
            <span>
              posted {timeAgo(new Date(event.createdAt).toISOString())}
              {event.editedAt ? " · edited" : ""}
            </span>
          </div>
          {mine && (
            <div className="gist-actions">
              <button
                type="button"
                className="gist-action"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
              <button
                type="button"
                className="gist-action text-bad"
                onClick={remove}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          )}
        </article>
      )}

      {!name && (
        <p className="subtle">
          <Link className="miva-link" href="/cliq">
            Log in
          </Link>{" "}
          to post your own event.
        </p>
      )}
    </section>
  );
}

function EventEditor({
  event,
  onCancel,
  onSaved,
}: {
  event: MivaEvent;
  onCancel: () => void;
  onSaved: (e: MivaEvent) => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [body, setBody] = useState(event.body);
  const [startsAt, setStartsAt] = useState(toLocalInput(event.startsAt));
  const [location, setLocation] = useState(event.location ?? "");
  const [link, setLink] = useState(event.link ?? "");
  const [department, setDepartment] = useState(event.department ?? "");
  const [asMe, setAsMe] = useState(event.authorName !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !title.trim() || !startsAt) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          body: body || undefined,
          startsAt: new Date(startsAt).toISOString(),
          location: location || undefined,
          link: link || undefined,
          department: department || undefined,
          showAuthor: asMe,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't save.");
        return;
      }
      onSaved(data.event);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card doc-card gist-composer" onSubmit={save}>
      <label className="composer-field">
        <span className="composer-label">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE}
          disabled={saving}
        />
      </label>
      <div className="composer-fields">
        <label className="composer-field">
          <span className="composer-label">When</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            disabled={saving}
          />
        </label>
        <label className="composer-field">
          <span className="composer-label">Location (optional)</span>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={saving}
          />
        </label>
      </div>
      <label className="composer-field">
        <span className="composer-label">Link (optional)</span>
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          disabled={saving}
        />
      </label>
      <label className="composer-field">
        <span className="composer-label">Details (optional)</span>
        <textarea
          className="gist-textarea"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={saving}
        />
      </label>
      <label className="composer-field">
        <span className="composer-label">Department (optional)</span>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          disabled={saving}
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
      <IdentityToggle value={asMe} onChange={setAsMe} disabled={saving} />
      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </div>
      )}
      <div className="gist-composer-foot">
        <span />
        <span className="row-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={saving || !title.trim() || !startsAt}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </div>
    </form>
  );
}