"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  replyCount: number;
};

type Reply = { id: string; body: string; createdAt: number };

const MAX_BODY = 2000;
const DEPT_GROUPS = departmentsBySchool();

export default function GistsClient() {
  const { name } = useApp();
  const [gists, setGists] = useState<Gist[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<string>(""); // category slug or ""

  const load = useCallback(async (category: string) => {
    setError(null);
    setGists(null);
    try {
      const qs = category ? `?category=${category}` : "";
      const res = await fetch(`/api/gists${qs}`);
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
    load(filter);
  }, [load, filter]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ before: String(nextBefore) });
      if (filter) qs.set("category", filter);
      const res = await fetch(`/api/gists?${qs}`);
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

  // A new post only belongs at the top if it matches the current filter.
  const onPosted = (g: Gist) =>
    setGists((prev) =>
      !filter || g.category === filter ? [g, ...(prev ?? [])] : prev,
    );

  return (
    <section className="fade-in doc-wrap" aria-labelledby="gists-title">
      <div className="doc-head">
        <div className="board-tabs" role="tablist" aria-label="Boards">
          <span className="board-tab is-current">Gists</span>
          <Link className="board-tab" href="/events">
            Events
          </Link>
        </div>
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

      <div className="filter-chips" role="group" aria-label="Filter by category">
        <button
          type="button"
          className={`chip-btn ${filter === "" ? "is-active" : ""}`}
          onClick={() => setFilter("")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.slug}
            type="button"
            className={`chip-btn ${filter === c.slug ? "is-active" : ""}`}
            onClick={() => setFilter(c.slug)}
            title={c.blurb}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => load(filter)}>
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
            <p>
              {filter
                ? `Nothing in ${categoryLabel(filter)} yet.`
                : "Nothing here yet. Be the first to post."}
            </p>
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
          <button className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
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
      <Link className="btn btn-primary btn-sm" href="/cliq">
        Log in to post
      </Link>
    </div>
  );
}

function Composer({ onPosted }: { onPosted: (g: Gist) => void }) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [department, setDepartment] = useState("");
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
        body: JSON.stringify({
          body,
          category,
          department: department || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't post that.");
        return;
      }
      onPosted(data.gist);
      setBody("");
      setDepartment("");
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

      <div className="composer-fields">
        <label className="composer-field">
          <span className="composer-label">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={posting}
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
      </div>

      {department && (
        <p className="composer-warn" role="status">
          ⚠ Tagging a department makes your post easier to trace back to you in a
          small programme. Leave it as “none” to stay fully anonymous.
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
  const [reported, setReported] = useState(false);

  const report = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
      <Link href={`/gists/${gist.id}`} className="gist-card-link">
        <div className="gist-meta">
          <span className="gist-author">Anonymous</span>
          <span aria-hidden="true">·</span>
          <span>{timeAgo(new Date(gist.createdAt).toISOString())}</span>
          {gist.category && gist.category !== "general" && (
            <span className="gist-tag">{categoryLabel(gist.category)}</span>
          )}
          {gist.department && (
            <span className="gist-tag gist-tag-dept">
              {departmentLabel(gist.department)}
            </span>
          )}
        </div>
        <p className="gist-body gist-body-clamp">{gist.body}</p>
      </Link>
      <div className="gist-actions">
        <Link href={`/gists/${gist.id}`} className="gist-action">
          💬 {gist.replyCount} {gist.replyCount === 1 ? "reply" : "replies"}
        </Link>
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
    </article>
  );
}
