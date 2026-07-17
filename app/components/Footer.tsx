"use client";

import { useEffect, useState } from "react";
import { compactNumber } from "@/lib/format";

type Metrics = { users: number; runs: number };

/**
 * Footer metric. Deliberately quiet — it's social proof, not a headline.
 * If the store isn't configured or the fetch fails, it renders nothing rather
 * than showing a zero.
 */
export default function Footer() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d || typeof d.users !== "number") return;
        if (d.users <= 0 && d.runs <= 0) return;
        setMetrics({ users: d.users, runs: d.runs });
      })
      .catch(() => {
        /* metric is decorative — never surface an error */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="footer">
      <div className="footer-row">
        <span>Miva Cliq</span>
        <span aria-hidden="true">·</span>
        <span>Your coursework, on autopilot.</span>
      </div>
      {metrics ? (
        <div className="footer-metric">
          {compactNumber(metrics.users)} student
          {metrics.users === 1 ? "" : "s"}
          <span aria-hidden="true"> · </span>
          {compactNumber(metrics.runs)} run{metrics.runs === 1 ? "" : "s"}
        </div>
      ) : null}
    </footer>
  );
}