/**
 * Per-device run history. Stored in localStorage, namespaced by user email so
 * two accounts on one browser don't see each other's runs. Nothing here ever
 * leaves the device.
 */
import type { HistoryCourse, HistoryRecord } from "./types";

export const LAST_RUN_KEY = "miva-cliq-last";
export const HISTORY_PREFIX = "miva-cliq-history:";

export function historyKey(email: string): string {
  return HISTORY_PREFIX + (email || "anon").toLowerCase();
}

export function loadHistory(email: string): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(historyKey(email));
    const arr = raw ? (JSON.parse(raw) as HistoryRecord[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveHistoryRecord(email: string, record: HistoryRecord): void {
  try {
    const list = loadHistory(email);
    list.unshift(record);
    localStorage.setItem(historyKey(email), JSON.stringify(list.slice(0, 25)));
  } catch {
    /* ignore quota / privacy mode */
  }
}

/** Latest result per course across all runs (for the "your courses" view). */
export function latestPerCourse(history: HistoryRecord[]): {
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