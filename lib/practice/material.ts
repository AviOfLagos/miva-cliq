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

/** A bullet line: "- ", "* ", "• " or "1. " / "1) ". */
const BULLET = /^(?:[-*•]|\d{1,2}[.)])\s+(.+)$/;
/** A heading line: "## Loops" or "Loops:". */
const HEADING_HASH = /^#{1,4}\s+(.+)$/;
export const MAX_NOTE_LINE_CHARS = 300;
export const MAX_HEADING_CHARS = 80;

/**
 * Lines that talk to a model rather than about the course. Saved notes are
 * shared with every student and quoted into later prompts, so anything that
 * reads like an instruction is dropped, even at the cost of the odd real line.
 */
const ADDRESSES_MODEL =
  /\b(ignore|disregard|forget|override|bypass|jailbreak)\b|\binstructions?\b|\bsystem\s+prompt\b|\bprompt\b|\byou\s+are\b|\byou\s+must\b|\bas\s+an\s+ai\b|\b(language|ai)\s+model\b|\bassistant\b|\bchatgpt\b|\bgemini\b|\brespond\s+(only\s+)?with\b|\breturn\s+only\b|\bnew\s+task\b|\bdeveloper\s+mode\b/i;

/** The prompt's own block markers, with or without their angle brackets. */
const DELIMITERS = /<<<|>>>|\b(OUTLINE|MATERIAL|NOTES|EXISTING)\s*(>>>|<<<)|(<<<|>>>)\s*(OUTLINE|MATERIAL|NOTES|EXISTING)\b/g;

/**
 * The model's notes, made safe to save, share and quote in a later prompt.
 * Only short bullet lines ("- point") and short heading lines ("Topic:") are
 * kept, normalised to "- " bullets and "Heading:" lines. Tags, URLs, the
 * prompt delimiters and any line addressing a model are removed. Returns ""
 * when there is nothing worth keeping.
 */
export function cleanNotes(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const kept: string[] = [];
  for (const rawLine of raw.replace(/\r/g, "").split("\n")) {
    const line = rawLine
      .replace(/<[^>]*>/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(DELIMITERS, " ")
      .replace(/[<>]{2,}/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (!line || ADDRESSES_MODEL.test(line)) continue;
    const bullet = line.match(BULLET);
    if (bullet) {
      const text = bullet[1].trim();
      if (text.length >= 3 && text.length <= MAX_NOTE_LINE_CHARS) kept.push(`- ${text}`);
      continue;
    }
    const hash = line.match(HEADING_HASH);
    const heading = hash ? hash[1].trim().replace(/:$/, "") : /:$/.test(line) ? line.slice(0, -1).trim() : null;
    if (heading && heading.length >= 2 && heading.length <= MAX_HEADING_CHARS && !/[.!?]$/.test(heading)) {
      kept.push(`${heading}:`);
    }
    // Anything else (prose paragraphs, long lines) is dropped.
  }
  // A heading with no bullets under it adds nothing.
  const lines = kept.filter((l, i) => l.startsWith("- ") || (kept[i + 1] ?? "").startsWith("- "));
  const s = lines.join("\n");
  return s.length < 80 ? "" : capAtLine(s, MAX_NOTES_CHARS);
}

/** Saved notes, made safe again on the way into a prompt (rows written before this rule). */
export const notesForPrompt = cleanNotes;

/* --------------------------------------------------------- file budget --- */

/**
 * The PDFs one gather may send inline, shared by concurrent downloads: a file
 * is only fetched while there is room, and only kept if it still fits, so no
 * bytes are held that will not be used.
 */
export class InlineBudget {
  private files = 0;
  private bytes = 0;
  private pending = 0;
  constructor(
    readonly maxFiles: number = MAX_PDFS,
    readonly maxBytes: number = MAX_INLINE_TOTAL_BYTES,
  ) {}
  /** No room left for another file: stop fetching. */
  full(): boolean {
    return this.files + this.pending >= this.maxFiles || this.bytes >= this.maxBytes;
  }
  /** Largest file still worth downloading. */
  room(): number {
    return Math.max(0, Math.min(MAX_FILE_BYTES, this.maxBytes - this.bytes));
  }
  /** Claim a download slot before fetching. False = do not fetch. */
  begin(): boolean {
    if (this.full()) return false;
    this.pending += 1;
    return true;
  }
  /** Finish a download: true if the file fits and is kept. */
  end(size: number | null): boolean {
    this.pending = Math.max(0, this.pending - 1);
    if (size === null || size <= 0 || this.files >= this.maxFiles || this.bytes + size > this.maxBytes) return false;
    this.files += 1;
    this.bytes += size;
    return true;
  }
}
