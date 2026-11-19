/**
 * Coverage: how far each course-week's question bank has got, in plain words,
 * so students fill the gaps instead of piling onto the same week. Pure and
 * import-free apart from the bank target, so the Study page uses it directly.
 */
import { BANK_TARGET } from "./targets.ts";

export type CoverageKind = "ready" | "started" | "empty" | "unknown";

export type WeekCoverage = { kind: CoverageKind; label: string };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * One week's state. `count` is usable (not hidden) questions; null means the
 * bank could not be read (practice not switched on yet), which is "unknown"
 * rather than a misleading "no questions".
 */
export function weekCoverage(count: number | null | undefined, target: number = BANK_TARGET): WeekCoverage {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return { kind: "unknown", label: "" };
  }
  if (count >= target) return { kind: "ready", label: `Ready: ${plural(count, "question")}` };
  if (count > 0) return { kind: "started", label: `Started: ${plural(count, "question")}` };
  return { kind: "empty", label: "No questions yet. Be the first to add this week." };
}

/** "5 of 12 weeks ready". Empty string when the bank could not be read. */
export function courseSummary(counts: (number | null | undefined)[], target: number = BANK_TARGET): string {
  if (!counts.length || counts.some((c) => typeof c !== "number")) return "";
  const ready = counts.filter((c) => (c as number) >= target).length;
  return `${ready} of ${plural(counts.length, "week")} ready`;
}
