"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/run/AppContext";
import { timeAgo } from "@/lib/format";
import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  categoryLabel,
  departmentLabel,
  departmentsBySchool,
} from "@/lib/taxonomy";

type Gist = {
  id: string;
  body: string;
  category: string;
  department: string | null;
  createdAt: number;
  editedAt: number | null;
  replyCount: number;
};

type Reply = {
  id: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
};

const MAX_BODY = 2000;
const DEPT_GROUPS = departmentsBySchool();

function metaLine(createdAt: number, editedAt: number | null): string {
  const base = timeAgo(new Date(createdAt).toISOString());
  return editedAt ? `${base} · edited` : base;
}

export default function GistDetail({ initialGist }: { initialGist: Gist }) {
  const { name } = useApp();
  const router = useRouter();
  const [gist, setGist] = useState<Gist>(initialGist);
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [ownedReplies, setOwnedReplies] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Re-fetch on mount to learn whether the viewer owns this post (the server
  // page can't know without the cookie in a cacheable render).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/gists/${initialGist.id}`);
      if (res.status === 404) {
        setGist((g) => ({ ...g, body: "" }));
        return;
      }
      const data = await res.json();
      if (data.gist) setGist(data.gist);
      setMine(!!data.mine);
    } catch {
      /* keep server-rendered copy */
    }
  }, [initialGist.id]);

  const loadReplies = useCallback(async () => {
    try {
      const res = await fetch(`/api/gists/${initialGist.id}/replies`);
      const data = await res.json();
      setReplies(Array.isArray(data.replies) ? data.replies : []);
      setOwnedReplies(new Set(Array.isArray(data.mine) ? data.mine : []));
    } catch {
      setReplies([]);
    }
  }, [initialGist.id]);

  useEffect(() => {
    refresh();
    loadReplies();
  }, [refresh, loadReplies]);

  const remove = async () => {
    if (!confirm("Delete this gist? This can't be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/gists/${gist.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        router.push("/gists");
        return;
      }
    } catch {
      /* fall through */
    }
    setDeleting(false);
  };

  return (
    <section className="fade-in doc-wrap">
      <div className="doc-head">
        <Link className="miva-link" href="/gists">
          <span aria-hidden="true">←</span> All gists
        </Link>
      </div>

      {editing ? (
        <GistEditor
          gist={gist}
          onCancel={() => setEditing(false)}
          onSaved={(g) => {
            setGist(g);
            setEditing(false);
          }}
        />
      ) : (
        <article className="card gist-card gist-detail">
          <div className="gist-meta">
            <span className="gist-author">Anonymous</span>
            <span aria-hidden="true">·</span>
            <span>{metaLine(gist.createdAt, gist.editedAt)}</span>
            {gist.category !== "general" && (
              <span className="gist-tag">{categoryLabel(gist.category)}</span>
            )}
            {gist.department && (
              <span className="gist-tag gist-tag-dept">
                {departmentLabel(gist.department)}
              </span>
            )}
          </div>
          <p className="gist-body gist-body-lg">{gist.body}</p>
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

      <h2 className="events-heading">
        {gist.replyCount} {gist.replyCount === 1 ? "reply" : "replies"}
      </h2>

      <div className="gist-replies gist-replies-page">
        {replies === null ? (
          <span className="subtle">Loading…</span>
        ) : (
          replies.map((r) => (
            <ReplyItem
              key={r.id}
              gistId={gist.id}
              reply={r}
              mine={ownedReplies.has(r.id)}
              onChanged={(next) =>
                setReplies((prev) =>
                  (prev ?? []).map((x) => (x.id === next.id ? next : x)),
                )
              }
              onDeleted={(id) => {
                setReplies((prev) => (prev ?? []).filter((x) => x.id !== id));
                setGist((g) => ({ ...g, replyCount: Math.max(0, g.replyCount - 1) }));
              }}
            />
          ))
        )}

        {name ? (
          <ReplyForm
            gistId={gist.id}
            onAdded={(r) => {
              setReplies((prev) => [...(prev ?? []), r]);
              setOwnedReplies((prev) => new Set(prev).add(r.id));
              setGist((g) => ({ ...g, replyCount: g.replyCount + 1 }));
            }}
          />
        ) : (
          <p className="subtle">
            <Link className="miva-link" href="/cliq">
              Log in
            </Link>{" "}
            to reply.
          </p>
        )}
      </div>
    </section>
  );
}

function GistEditor({
  gist,
  onCancel,
  onSaved,
}: {
  gist: Gist;
  onCancel: () => void;
  onSaved: (g: Gist) => void;
}) {
  const [body, setBody] = useState(gist.body);
  const [category, setCategory] = useState(gist.category || DEFAULT_CATEGORY);
  const [department, setDepartment] = useState(gist.department ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/gists/${gist.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body, category, department: department || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't save.");
        return;
      }
      onSaved(data.gist);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const over = body.length > MAX_BODY;

  return (
    <form className="card doc-card gist-composer" onSubmit={save}>
      <textarea
        className="gist-textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        disabled={saving}
      />
      <div className="composer-fields">
        <label className="composer-field">
          <span className="composer-label">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={saving}
          >
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
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
      </div>
      {department && (
        <p className="composer-warn" role="status">
          ⚠ Tagging a department makes your post easier to trace back to you.
        </p>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </div>
      )}
      <div className="gist-composer-foot">
        <span className={`gist-count ${over ? "text-bad" : ""}`}>
          {body.length}/{MAX_BODY}
        </span>
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
            disabled={saving || !body.trim() || over}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </div>
    </form>
  );
}

function ReplyItem({
  gistId,
  reply,
  mine,
  onChanged,
  onDeleted,
}: {
  gistId: string;
  reply: Reply;
  mine: boolean;
  onChanged: (r: Reply) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(reply.body);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy || !body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/gists/${gistId}/replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.reply) {
        onChanged(data.reply);
        setEditing(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this reply?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/gists/${gistId}/replies/${reply.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) onDeleted(reply.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gist-reply">
      <div className="gist-meta">
        <span className="gist-author">Anonymous</span>
        <span aria-hidden="true">·</span>
        <span>{metaLine(reply.createdAt, reply.editedAt)}</span>
      </div>
      {editing ? (
        <div className="gist-reply-form">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
            aria-label="Edit reply"
          />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            Save
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setBody(reply.body);
              setEditing(false);
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p className="gist-body">{reply.body}</p>
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
                disabled={busy}
              >
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReplyForm({
  gistId,
  onAdded,
}: {
  gistId: string;
  onAdded: (r: Reply) => void;
}) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (posting || !body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/gists/${gistId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't reply.");
        return;
      }
      onAdded(data.reply);
      setBody("");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <form className="gist-reply-form" onSubmit={submit}>
      <input
        type="text"
        placeholder="Reply anonymously…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={posting}
        aria-label="Reply"
      />
      <button
        type="submit"
        className="btn btn-ghost btn-sm"
        disabled={posting || !body.trim()}
      >
        {posting ? "…" : "Reply"}
      </button>
      {error && <span className="text-bad gist-count">{error}</span>}
    </form>
  );
}