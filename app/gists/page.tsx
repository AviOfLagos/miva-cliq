"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/run/AppContext";
import { timeAgo } from "@/lib/format";

type Gist = {
  id: string;
  body: string;
  createdAt: number;
  replyCount: number;
};

type Reply = { id: string; body: string; createdAt: number };

const MAX_BODY = 2000;

export default function GistsPage() {
  const { name } = useApp();
  const [gists, setGists] = useState<Gist[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/gists");
      const data = await res.json();
      setGists(Array.isArray(data.gists) ? data.gists : []);
      setEnabled(data.enabled !== false);
      setNextBefore(data.nextBefore ?? null);
    } catch {
      setError("Couldn't load gists.");
      setGists([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/gists?before=${nextBefore}`);
      const data = await res.json();
      const more: Gist[] = Array.isArray(data.gists) ? data.gists : [];
      setGists((prev) => [...(prev ?? []), ...more]);
      setNextBefore(more.length ? data.nextBefore ?? null : null);
    } catch {
      /* leave the button for another try */
    } finally {
      setLoadingMore(false);
    }
  };

  const onPosted = (g: Gist) => setGists((prev) => [g, ...(prev ?? [])]);

  return (
    <section className="fade-in doc-wrap" aria-labelledby="gists-title">
      <div className="doc-head">
        <h1 id="gists-title" className="section-title">
          Miva Gists
        </h1>
        <p className="subtle">
          Anonymous notes from Miva students. No names, no profiles — just what
          people are saying.
        </p>
      </div>

      {!enabled && (
        <div className="alert alert-notice" role="status">
          <span aria-hidden="true">🔌</span>
          <span>Gists isn&apos;t configured on this deployment yet.</span>
        </div>
      )}

      {enabled && (name ? <Composer onPosted={onPosted} /> : <LoginPrompt />)}

      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {gists === null ? (
        <div className="card doc-card">
          <div className="skeleton-lines">
            <span className="skeleton w-70" />
            <span className="skeleton w-40" />
          </div>
        </div>
      ) : gists.length === 0 ? (
        <div className="card doc-card">
          <div className="empty">
            <span aria-hidden="true">💬</span>
            <p>Nothing here yet. Be the first to post.</p>
          </div>
        </div>
      ) : (
        <div className="gist-feed">
          {gists.map((g) => (
            <GistCard key={g.id} gist={g} canPost={!!name} />
          ))}
        </div>
      )}

      {nextBefore && gists && gists.length > 0 && (
        <div className="doc-foot">
          <button
            className="btn btn-ghost"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load older"}
          </button>
        </div>
      )}
    </section>
  );
}

function LoginPrompt() {
  return (
    <div className="card doc-card gist-login">
      <p className="doc-body">
        Posts are anonymous, but you need to be logged in to write one — it&apos;s
        the only thing keeping spam out.{" "}
        <Link className="miva-link" href="/how-it-works">
          What we store
        </Link>
      </p>
      <Link className="btn btn-primary btn-sm" href="/">
        Log in to post
      </Link>
    </div>
  );
}

function Composer({ onPosted }: { onPosted: (g: Gist) => void }) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (posting || !body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/gists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't post that.");
        return;
      }
      onPosted(data.gist);
      setBody("");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPosting(false);
    }
  };

  const over = body.length > MAX_BODY;

  return (
    <form className="card doc-card gist-composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="gist-body">
        Write a gist
      </label>
      <textarea
        id="gist-body"
        className="gist-textarea"
        placeholder="What's the gist? Posts here are anonymous."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        disabled={posting}
      />
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
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={posting || !body.trim() || over}
        >
          {posting ? "Posting…" : "Post anonymously"}
        </button>
      </div>
    </form>
  );
}

function GistCard({ gist, canPost }: { gist: Gist; canPost: boolean }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [count, setCount] = useState(gist.replyCount);
  const [reported, setReported] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && replies === null) {
      try {
        const res = await fetch(`/api/gists/${gist.id}/replies`);
        const data = await res.json();
        setReplies(Array.isArray(data.replies) ? data.replies : []);
      } catch {
        setReplies([]);
      }
    }
  };

  const report = async () => {
    setReported(true);
    try {
      await fetch(`/api/gists/${gist.id}/report`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* reporting is best-effort */
    }
  };

  return (
    <article className="card gist-card">
      <div className="gist-meta">
        <span className="gist-author">Anonymous</span>
        <span aria-hidden="true">·</span>
        <span>{timeAgo(new Date(gist.createdAt).toISOString())}</span>
      </div>
      <p className="gist-body">{gist.body}</p>
      <div className="gist-actions">
        <button type="button" className="gist-action" onClick={toggle}>
          💬 {count} {count === 1 ? "reply" : "replies"}
        </button>
        {canPost && (
          <button
            type="button"
            className="gist-action"
            onClick={report}
            disabled={reported}
            title="Report this post"
          >
            {reported ? "Reported" : "Report"}
          </button>
        )}
      </div>

      {open && (
        <div className="gist-replies">
          {replies === null ? (
            <span className="subtle">Loading…</span>
          ) : (
            <>
              {replies.map((r) => (
                <div key={r.id} className="gist-reply">
                  <div className="gist-meta">
                    <span className="gist-author">Anonymous</span>
                    <span aria-hidden="true">·</span>
                    <span>{timeAgo(new Date(r.createdAt).toISOString())}</span>
                  </div>
                  <p className="gist-body">{r.body}</p>
                </div>
              ))}
              {canPost ? (
                <ReplyForm
                  gistId={gist.id}
                  onAdded={(r) => {
                    setReplies((prev) => [...(prev ?? []), r]);
                    setCount((c) => c + 1);
                  }}
                />
              ) : (
                <p className="subtle">
                  <Link className="miva-link" href="/">
                    Log in
                  </Link>{" "}
                  to reply.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </article>
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