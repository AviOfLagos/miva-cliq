"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearGeminiKey, loadGeminiKey, saveGeminiKey } from "@/lib/run/prefs";

const AI_STUDIO = "https://aistudio.google.com/app/apikey";

function mask(k: string): string {
  return k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "saved";
}

type Status = { tone: "good" | "bad" | "info"; text: string } | null;

export default function KeyClient({ back }: { back: string | null }) {
  const [saved, setSaved] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    setSaved(loadGeminiKey());
  }, []);

  const save = () => {
    const k = value.trim();
    if (!k) return;
    saveGeminiKey(k);
    setSaved(k);
    setValue("");
    setStatus({ tone: "good", text: "Saved in this browser." });
  };

  const test = async () => {
    const k = (value.trim() || saved).trim();
    if (!k) {
      setStatus({ tone: "bad", text: "Paste your key first." });
      return;
    }
    setBusy(true);
    setStatus({ tone: "info", text: "Testing with one tiny call to Google…" });
    try {
      const res = await fetch("/api/practice/key-test", {
        method: "POST",
        credentials: "include",
        headers: { "x-gemini-key": k },
      });
      const json = (await res.json().catch(() => null)) as any;
      if (res.ok && json?.ok) {
        saveGeminiKey(k);
        setSaved(k);
        setValue("");
        setStatus({ tone: "good", text: "It works. Saved in this browser." });
      } else if (res.status === 401) {
        setStatus({ tone: "bad", text: "Log in with your Miva account first, then test the key." });
      } else {
        setStatus({ tone: "bad", text: json?.error || "That key didn't work. Check you copied all of it." });
      }
    } catch {
      setStatus({ tone: "bad", text: "Couldn't reach us to test it. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    clearGeminiKey();
    setSaved("");
    setStatus({ tone: "info", text: "Removed from this browser." });
  };

  return (
    <section className="answers-page practice-page">
      <header className="answers-head">
        <Link href={back || "/study"} className="subtle practice-back">
          ← {back && back !== "/study" ? "Back to practice" : "Study"}
        </Link>
        <h1>Get a free Gemini key</h1>
        <p className="subtle">
          A Gemini key lets you create practice questions for a week that doesn&apos;t have enough yet. It&apos;s
          free from Google and takes about two minutes. The questions you create are shared with everyone on that
          course, so each week only needs it once.
        </p>
      </header>

      <ol className="card key-steps">
        <li>
          Open{" "}
          <a className="miva-link" href={AI_STUDIO} target="_blank" rel="noopener noreferrer">
            aistudio.google.com
          </a>{" "}
          and sign in with any Google account (your Gmail is fine).
        </li>
        <li>
          Tap <strong>Get API key</strong>. Accept the terms if Google asks.
        </li>
        <li>
          Tap <strong>Create API key</strong>. If it asks for a project, pick the one it suggests.
        </li>
        <li>
          Tap <strong>Copy</strong> next to the new key. It starts with <code>AIza</code>.
        </li>
        <li>Come back here, paste it below and tap Test key.</li>
      </ol>

      <div className="card key-form">
        {saved ? (
          <p className="key-saved">
            Key saved in this browser: <code>{mask(saved)}</code>
          </p>
        ) : (
          <p className="subtle">No key saved in this browser yet.</p>
        )}
        <label className="answer-value-label" htmlFor="gemini-key">
          {saved ? "Replace it" : "Paste your key"}
        </label>
        <input
          id="gemini-key"
          className="input key-input"
          type="password"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="AIza…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="answer-actions">
          <button type="button" className="btn btn-primary" onClick={test} disabled={busy || (!value.trim() && !saved)}>
            {busy ? "Testing…" : "Test key"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={save} disabled={busy || !value.trim()}>
            Save without testing
          </button>
          {saved && (
            <button type="button" className="btn btn-ghost" onClick={remove} disabled={busy}>
              Remove key
            </button>
          )}
        </div>
        <p
          className={`key-status ${status?.tone === "good" ? "is-good" : status?.tone === "bad" ? "is-bad" : ""}`}
          aria-live="polite"
        >
          {status?.text ?? ""}
        </p>
        {saved && back && (
          <Link href={back} className="btn btn-primary btn-block">
            {back === "/study" ? "Back to Study to prepare" : "Create questions now"}
          </Link>
        )}
      </div>

      <div className="card key-privacy">
        <h2 className="study-week-title">Where your key goes</h2>
        <ul className="doc-list">
          <li>
            Your key stays in this browser (its local storage on this phone or computer). We do not save it on our
            servers or in any database.
          </li>
          <li>
            When you create questions or test the key, this page sends it to our server with that one request. Our
            server passes it straight to Google to make that call, then forgets it. It is never written to our logs.
          </li>
          <li>
            Google may count the calls against your free limit. Creating one week&apos;s questions is one call.
          </li>
          <li>
            On a shared device, anyone using this browser could use the key. Tap Remove key when you&apos;re done,
            or delete the key in AI Studio at any time.
          </li>
        </ul>
        <p className="subtle">
          More in our <Link className="miva-link" href="/privacy">privacy policy</Link>.
        </p>
      </div>
    </section>
  );
}
