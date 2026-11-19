/**
 * Gather one course-week's material from the LMS, server-side, for a single
 * generation call: page/book bodies as cleaned text, small PDFs as base64 for
 * Gemini's inline data. Videos, external links, big files and anything that
 * fails are skipped. The whole gather is time-boxed (an AbortSignal cancels
 * in-flight LMS requests at the deadline) and byte-budgeted (sizes are checked
 * from the headers before a body is read, reading stops past the per-file cap,
 * and no further files are fetched once the PDF count or inline byte budget is
 * spent), so the generate route stays inside its maxDuration and memory. Nothing here is stored: the caller keeps only
 * the model's notes.
 */
import type { MoodleSession } from "@/lib/moodle/auth";
import { getCourseState } from "@/lib/moodle/activities";
import { listCourses, codeOf } from "@/lib/moodle/courses";
import { fetchMaterial, type MaterialOptions } from "@/lib/moodle/materials";
import { capMaterial, InlineBudget, isInlinePdf, MAX_FILE_BYTES, pickMaterialActivities, type MaterialText } from "./material";

export type GatheredMaterial = {
  texts: MaterialText[];
  pdfs: { mimeType: string; data: string }[];
  /** Activities that gave us something. */
  sourceCount: number;
};

const CONCURRENCY = 3;
const MAX_TEXT_FILE_BYTES = 512 * 1024;

/** Resolve to `fallback` if `p` has not settled by `deadline` (epoch ms). The late result is ignored. */
function before<T>(p: Promise<T>, deadline: number, fallback: T): Promise<T> {
  const ms = deadline - Date.now();
  if (ms <= 0) return Promise.resolve(fallback);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((r) => {
      timer = setTimeout(() => r(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Is this student enrolled in `courseId`, and is it the course `courseCode`
 * names? Checked against their own course list so a forged courseId cannot
 * point the gather at another course.
 */
export async function enrolledCourse(
  session: MoodleSession,
  courseId: number,
  courseCode: string,
  deadline: number,
): Promise<boolean> {
  const courses = await before(listCourses(session), deadline, []);
  const c = courses.find((x) => x.id === courseId);
  return !!c && codeOf(c.fullname) === courseCode;
}

export async function gatherWeekMaterial(
  session: MoodleSession,
  courseId: number,
  week: number,
  deadline: number,
): Promise<GatheredMaterial> {
  const empty: GatheredMaterial = { texts: [], pdfs: [], sourceCount: 0 };
  const state = await before(getCourseState(session, courseId), deadline, null);
  if (!state) return empty;
  const acts = pickMaterialActivities(state.activities, week);
  if (!acts.length) return empty;

  // Every LMS fetch below is tied to the deadline: when it passes, in-flight
  // downloads are aborted, not just ignored.
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const budget = new InlineBudget();
  const raw: MaterialText[] = [];
  const pdfs: GatheredMaterial["pdfs"] = [];
  const isText = (contentType: string) => /^text\/plain/i.test(contentType);
  const isPdf = (filename: string, contentType: string) =>
    /application\/pdf/i.test(contentType) || /\.pdf$/i.test(filename);

  const opts: MaterialOptions = {
    signal,
    beforeFile: () => budget.begin(),
    maxBytesNow: () => (budget.full() ? 0 : budget.room()),
    // Only PDFs and plain text are worth reading; videos and the rest are never downloaded.
    accept: ({ filename, contentType, declaredBytes }) =>
      isText(contentType) ? declaredBytes <= MAX_TEXT_FILE_BYTES : isPdf(filename, contentType),
    afterFile: (f) => {
      if (f && isText(f.contentType)) {
        budget.end(null); // release the slot: text does not count against the PDF budget
        return f.bytes.length <= MAX_TEXT_FILE_BYTES;
      }
      // A PDF is kept only if it still fits; otherwise its bytes are dropped here.
      return !!f && isInlinePdf({ filename: f.filename, contentType: f.contentType, size: f.bytes.length }) && budget.end(f.bytes.length);
    },
  };

  let sourceCount = 0;
  let next = 0;
  const worker = async () => {
    while (next < acts.length && !signal.aborted) {
      const i = next++;
      const r = await before(fetchMaterial(session, acts[i], MAX_FILE_BYTES, opts), deadline, null);
      if (!r) continue;
      let used = false;
      if (r.text) {
        raw.push({ title: acts[i].name, text: r.text });
        used = true;
      }
      for (const f of r.files) {
        if (isText(f.contentType)) raw.push({ title: f.filename, text: f.bytes.toString("utf8") });
        else pdfs.push({ mimeType: "application/pdf", data: f.bytes.toString("base64") });
        used = true;
      }
      if (used) sourceCount += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, acts.length) }, worker));

  const texts = capMaterial(raw);
  if (!texts.length && !pdfs.length) return empty;
  return { texts, pdfs, sourceCount };
}
