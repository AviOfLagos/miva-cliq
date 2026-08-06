/**
 * Build one course's offline study pack: every lecturer-shared document plus a
 * markdown file per ungraded practice quiz, zipped under a folder named after
 * the course. Drop the folder into NotebookLM, or read it with no network.
 *
 *   <Course>/
 *     README.md                  what's inside + what was skipped and why
 *     Documents/<Section>/…      PDFs, slides, docs, folder contents
 *     Notes/<Section>/….md       inline `page` / `book` activities as markdown
 *     Quizzes/….md               questions + options, no answers
 *     Links.md                   external `url` activities
 *
 * Everything is buffered in memory, so the caps below are what keep a pack
 * inside a serverless function's memory and duration budget.
 */
import type { MoodleSession } from "@/lib/moodle/auth";
import { getCourseState, type Activity, type Section } from "@/lib/moodle/activities";
import { fetchMaterial, isMaterial } from "@/lib/moodle/materials";
import { isUngradedName } from "@/lib/moodle/quiz";
import { dumpQuiz, renderQuizMarkdown } from "./quizDump";
import { makeZip, safeSegment, uniquePath, type ZipEntry } from "./zip";

/** Skip any single file bigger than this — one huge video would eat the pack. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Hard ceiling for the whole archive. */
export const MAX_TOTAL_BYTES = 120 * 1024 * 1024;
/** Parallel material downloads. Enough to be quick, gentle on the LMS. */
const CONCURRENCY = 4;

export interface PackOptions {
  includeDocs: boolean;
  includeQuizzes: boolean;
  /** Open (never submit) an attempt on quizzes with no prior attempt, to read them. */
  openAttempts: boolean;
}

export interface PackPlan {
  courseId: number;
  courseName: string;
  documents: { cmid: number; name: string; modname: string; section: number | null }[];
  quizzes: { cmid: number; name: string; section: number | null }[];
  /** Quizzes present in the course but excluded (graded / unrecognised names). */
  excludedQuizzes: { cmid: number; name: string; reason: string }[];
}

export interface PackReport {
  courseName: string;
  filename: string;
  fileCount: number;
  documentCount: number;
  noteCount: number;
  quizCount: number;
  questionCount: number;
  linkCount: number;
  bytes: number;
  skipped: { name: string; reason: string }[];
}

/** What a pack for this course would contain, without downloading anything. */
export async function planPack(
  session: MoodleSession,
  courseId: number,
  courseName: string,
): Promise<PackPlan> {
  const { activities } = await getCourseState(session, courseId);
  const documents = activities
    .filter(isMaterial)
    .map((a) => ({ cmid: a.cmid, name: a.name, modname: a.modname, section: a.section }));

  const quizzes: PackPlan["quizzes"] = [];
  const excludedQuizzes: PackPlan["excludedQuizzes"] = [];
  for (const a of activities.filter((x) => x.modname === "quiz")) {
    if (isUngradedName(a.name)) quizzes.push({ cmid: a.cmid, name: a.name, section: a.section });
    else
      excludedQuizzes.push({
        cmid: a.cmid,
        name: a.name,
        reason: "graded or unrecognised — never exported",
      });
  }
  return { courseId, courseName, documents, quizzes, excludedQuizzes };
}

function sectionFolder(sections: Section[], n: number | null): string {
  if (n === null || n === undefined) return "Unsorted";
  const title = sections.find((s) => s.number === n)?.title;
  const label = title && !/^(general|topic \d+)$/i.test(title) ? title : null;
  const num = String(n).padStart(2, "0");
  return safeSegment(label ? `${num} - ${label}` : n === 0 ? "00 - General" : `Section ${num}`);
}

/** Run `worker` over `items` with a fixed number of parallel slots, in order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function buildPack(
  session: MoodleSession,
  courseId: number,
  courseName: string,
  opts: PackOptions,
): Promise<{ zip: Buffer; report: PackReport }> {
  const { activities, sections } = await getCourseState(session, courseId);
  const root = safeSegment(courseName, `Course ${courseId}`);
  const exportedOn = new Date().toISOString().slice(0, 10);

  const entries: ZipEntry[] = [];
  const taken = new Set<string>();
  const skipped: { name: string; reason: string }[] = [];
  const links: { name: string; url: string }[] = [];
  let total = 0;
  let documentCount = 0;
  let noteCount = 0;
  let quizCount = 0;
  let questionCount = 0;

  const push = (path: string, data: Buffer, label: string): boolean => {
    if (total + data.length > MAX_TOTAL_BYTES) {
      skipped.push({ name: label, reason: "pack size limit reached" });
      return false;
    }
    entries.push({ path: uniquePath(path, taken), data });
    total += data.length;
    return true;
  };

  // --- documents, notes, links -------------------------------------------
  if (opts.includeDocs) {
    const materials = activities.filter(isMaterial);
    const fetched = await mapPool(materials, CONCURRENCY, (a) =>
      fetchMaterial(session, a, MAX_FILE_BYTES),
    );

    materials.forEach((activity: Activity, i) => {
      const result = fetched[i];
      const folder = sectionFolder(sections, activity.section);

      if (result.skipped && !result.files.length && !result.text && !result.link) {
        skipped.push({ name: activity.name, reason: result.skipped });
        return;
      }
      for (const file of result.files) {
        const path = `${root}/Documents/${folder}/${safeSegment(file.filename, activity.name)}`;
        if (push(path, file.bytes, activity.name)) documentCount++;
      }
      if (result.text) {
        const body = `# ${activity.name}\n\n_${courseName} · exported from Miva LMS on ${exportedOn}_\n\n${result.text}\n`;
        const path = `${root}/Notes/${folder}/${safeSegment(activity.name)}.md`;
        if (push(path, Buffer.from(body, "utf8"), activity.name)) noteCount++;
      }
      if (result.link) links.push({ name: activity.name, url: result.link });
    });

    if (links.length) {
      const body = [
        `# External links — ${courseName}`,
        "",
        `_Exported from Miva LMS on ${exportedOn}. These live off the LMS and need network._`,
        "",
        ...links.map((l) => `- [${l.name}](${l.url})`),
        "",
      ].join("\n");
      push(`${root}/Links.md`, Buffer.from(body, "utf8"), "Links.md");
    }
  }

  // --- ungraded quizzes ---------------------------------------------------
  const quizzes = activities.filter((a) => a.modname === "quiz");
  if (opts.includeQuizzes) {
    // Sequential on purpose: quiz reads can open attempts, and hammering
    // startattempt.php in parallel is exactly what a human never does.
    for (const quiz of quizzes) {
      const dump = await dumpQuiz(session, quiz.cmid, quiz.name, opts.openAttempts);
      if (!dump.questions.length) {
        skipped.push({ name: quiz.name, reason: dump.skipped || "no questions found" });
        continue;
      }
      const md = renderQuizMarkdown(dump, courseName, exportedOn);
      const prefix =
        quiz.section !== null && quiz.section !== undefined
          ? `${String(quiz.section).padStart(2, "0")} - `
          : "";
      const path = `${root}/Quizzes/${safeSegment(prefix + quiz.name)}.md`;
      if (push(path, Buffer.from(md, "utf8"), quiz.name)) {
        quizCount++;
        questionCount += dump.questions.length;
      }
    }
  }

  // --- README -------------------------------------------------------------
  const readme = [
    `# ${courseName}`,
    "",
    `Offline study pack exported from Miva LMS on ${exportedOn} by Miva Cliq.`,
    "",
    "## What's inside",
    "",
    `- **Documents/** — ${documentCount} file${documentCount === 1 ? "" : "s"} shared in the course, grouped by section.`,
    `- **Notes/** — ${noteCount} inline page${noteCount === 1 ? "" : "s"} written straight into the LMS, saved as markdown.`,
    `- **Quizzes/** — ${quizCount} ungraded practice quiz${quizCount === 1 ? "" : "zes"}, ${questionCount} question${questionCount === 1 ? "" : "s"} total. Questions and options only, no answers.`,
    `- **Links.md** — ${links.length} external link${links.length === 1 ? "" : "s"}.`,
    "",
    "Graded quizzes, mid-semester and exam assessments are never exported.",
    "",
    ...(skipped.length
      ? [
          "## Not included",
          "",
          ...skipped.map((s) => `- **${s.name}** — ${s.reason}`),
          "",
        ]
      : []),
  ].join("\n");
  entries.unshift({ path: uniquePath(`${root}/README.md`, taken), data: Buffer.from(readme, "utf8") });

  const zip = makeZip(entries);
  return {
    zip,
    report: {
      courseName,
      filename: `${root}.zip`,
      fileCount: entries.length,
      documentCount,
      noteCount,
      quizCount,
      questionCount,
      linkCount: links.length,
      bytes: zip.length,
      skipped,
    },
  };
}
