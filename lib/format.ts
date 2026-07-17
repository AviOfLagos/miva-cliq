export const LMS_BASE = "https://lms.miva.university";

/** Deep-link to a course on the Miva LMS (opens the real dashboard). */
export function mivaCourseUrl(courseId: number): string {
  return `${LMS_BASE}/course/view.php?id=${courseId}`;
}

export function timeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  } catch {
    return "";
  }
}

/** Compact counts for the footer metric: 1200 -> "1.2k". */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}m`;
}