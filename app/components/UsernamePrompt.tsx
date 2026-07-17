"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/run/AppContext";

/**
 * One-time (and later, edit) handle picker. Opened lazily the first time a user
 * tries to post under a name or reply. On success it updates AppContext so the
 * caller can continue whatever action triggered it.
 */
export default function UsernamePrompt({
  open,
  onClose,
  onSaved,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (username: string) => void;
  reason?: string;
}) {
  const { username, setUsername } = useApp();
  const [value, setValue] = useState(username ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(username ?? "");
      setError(null);
      // Focus after paint.
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open, username]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: value.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't save that username.");
        return;
      }
      setUsername(data.username);
      onSaved?.(data.username);
      onClose();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

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
        aria-labelledby="username-modal-title"
      >
        <div className="modal-head">
          <div>
            <span className="badge badge-custom">USERNAME</span>
            <h3 id="username-modal-title" className="modal-title">
              {username ? "Change your username" : "Pick a username"}
            </h3>
            <p className="modal-sub">
              {reason ||
                "This is the name shown when you post as yourself or reply. You can stay anonymous on posts anytime."}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form className="modal-body" onSubmit={submit}>
          <div className="username-field">
            <span className="username-at" aria-hidden="true">
              @
            </span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="handle"
              maxLength={20}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Username"
              disabled={saving}
            />
          </div>
          <p className="username-hint">
            3–20 characters · letters, numbers, and underscore
          </p>
          {error && (
            <div className="alert alert-error" role="alert">
              <span aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <div className="modal-foot">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !value.trim()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
