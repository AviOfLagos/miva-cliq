/**
 * Week material for generation: which LMS activities to read, how to clean
 * their text, and how to cap what the model writes back as notes. Pure (no
 * `@/`, no I/O) so `node --test` covers it.
 *
 * "Summaries, not copies" (docs/product/web-app-plan.md): material text is
 * read for one Gemini call and dropped. Only the model's condensed notes are
 * saved, capped at MAX_NOTES_CHARS.
 */

/** Activity types worth reading for a week's content. url/video/quiz/forum are skipped. */
export const MATERIAL_TEXT_MODS = ["page", "book", "resource", "folder"] as const;

/** At most this many activities are read per week, in course order. */
export const MAX_ACTIVITIES = 8;
/** A file over this is skipped (also passed to fetchMaterial as its download cap). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** PDFs sent inline to Gemini, in total. Base64 adds a third; Gemini's inline cap is 20 MB. */
export const MAX_INLINE_TOTAL_BYTES = 8 * 1024 * 1024;
/** At most this many PDFs per call. */
export const MAX_PDFS = 4;
/** Per source and in total, after cleaning. Keeps the prompt and the call time bounded. */
export const MAX_SOURCE_CHARS = 12_000;
export const MAX_MATERIAL_CHARS = 40_000;
/** Saved notes. */
export const MAX_NOTES_CHARS = 6_000;

type ActivityLike = { modname: string; section: number | null; uservisible?: boolean; name?: string };

/** The week's readable activities: right section, a text-bearing type, visible to the student. */
export function pickMaterialActivities<A extends ActivityLike>(activities: A[], week: number): A[] {
  return activities
    .filter(
      (a) =>
        a.section === week &&
        a.uservisible !== false &&
        (MATERIAL_TEXT_MODS as readonly string[]).includes(a.modname) &&
        !/\b(video|recording|lecture video|youtube)\b/i.test(a.name ?? ""),
    )
    .slice(0, MAX_ACTIVITIES);
}

/** Moodle chrome that turns up inside page bodies and adds nothing to a summary. */
const BOILERPLATE: RegExp[] = [
  /^skip to (main )?content$/i,
  /^(mark as done|done|to do|completion requirements|receive a grade)\b/i,
  /^(previous|next) (activity|section|page)\b/i,
  /^jump to\b/i,
  /^you are logged in as\b/i,
  /^(data retention summary|get the mobile app|powered by moodle)\b/i,
  /^last modified:/i,
  /^opened:|^due:|^closed:/i,
  /^(home|dashboard|my courses|course|participants|grades)$/i,
  /^\[image: [^\]]*\]$/i,
  /^[|\s-]*$/,
];

/**
 * Markdown from lib/export/html.ts -> plain study text: links reduced to their
 * words (no URLs, which carry session-specific pluginfile paths), images and
 * Moodle chrome lines dropped, repeated lines removed, whitespace collapsed,
 * the prompt delimiters neutralised, and capped.
 */
export function cleanMaterialText(md: string, cap: number = MAX_SOURCE_CHARS): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  const text = String(md ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<<<|>>>/g, " ")
    .replace(/\r/g, "");
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    if (!line) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    if (BOILERPLATE.some((re) => re.test(line))) continue;
    const key = line.toLowerCase();
    if (line.length > 3 && seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return capAtLine(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), cap);
}

/** Cut to `cap` characters at the last line break (or space) before it. */
export function capAtLine(s: string, cap: number): string {
  if (s.length <= cap) return s;
  const cut = s.slice(0, cap);
  const nl = cut.lastIndexOf("\n");
  const at = nl > cap * 0.6 ? nl : cut.lastIndexOf(" ");
  return (at > cap * 0.6 ? cut.slice(0, at) : cut).trimEnd();
}

export type MaterialText = { title: string; text: string };

/** Keep sources in order until the total cap; each one cleaned, short ones dropped. */
export function capMaterial(sources: MaterialText[], total: number = MAX_MATERIAL_CHARS): MaterialText[] {
  const out: MaterialText[] = [];
  let used = 0;
  for (const s of sources) {
    const text = cleanMaterialText(s.text);
    if (text.length < 40) continue;
    const room = total - used;
    if (room < 200) break;
    const kept = capAtLine(text, room);
    out.push({ title: cleanMaterialText(s.title, 160).replace(/\n/g, " "), text: kept });
    used += kept.length;
  }
  return out;
}

/** Is this download a PDF small enough to send inline? */
export function isInlinePdf(f: { filename: string; contentType: string; size: number }): boolean {
  const pdf = /application\/pdf/i.test(f.contentType) || /\.pdf$/i.test(f.filename);
  return pdf && f.size > 0 && f.size <= MAX_FILE_BYTES;
}

/**
 * The model's notes, made safe to save and to quote in a later prompt: plain
 * text, no tags or URLs, no delimiter sequences, sane spacing, capped.
 * Returns "" when there is nothing worth keeping.
 */
export function cleanNotes(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<<<|>>>/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.length < 80 ? "" : capAtLine(s, MAX_NOTES_CHARS);
}
