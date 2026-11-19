/**
 * Gather one course-week's material from the LMS, server-side, for a single
 * generation call: page/book bodies as cleaned text, small PDFs as base64 for
 * Gemini's inline data. Videos, external links, big files and anything that
 * fails are skipped. The whole gather is time-boxed so the generate route
 * stays inside its maxDuration. Nothing here is stored: the caller keeps only
 * the model's notes.
 */
import type { MoodleSession } from "@/lib/moodle/auth";
import { getCourseState } from "@/lib/moodle/activities";
import { listCourses, codeOf } from "@/lib/moodle/courses";
import { fetchMaterial } from "@/lib/moodle/materials";
import {
  capMaterial,
  isInlinePdf,
  MAX_FILE_BYTES,
  MAX_INLINE_TOTAL_BYTES,
  MAX_PDFS,
  pickMaterialActivities,
  type MaterialText,
} from "./material";

export type GatheredMaterial = {
  texts: MaterialText[];
  pdfs: { mimeType: string; data: string }[];
  /** Activities that gave us something. */
  sourceCount: number;
};

const CONCURRENCY = 3;

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

  const results = new Array<Awaited<ReturnType<typeof fetchMaterial>> | null>(acts.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < acts.length && Date.now() < deadline) {
      const i = next++;
      results[i] = await before(fetchMaterial(session, acts[i], MAX_FILE_BYTES), deadline, null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, acts.length) }, worker));

  const raw: MaterialText[] = [];
  const pdfs: GatheredMaterial["pdfs"] = [];
  let inlineBytes = 0;
  let sourceCount = 0;
  results.forEach((r, i) => {
    if (!r) return;
    let used = false;
    if (r.text) {
      raw.push({ title: acts[i].name, text: r.text });
      used = true;
    }
    for (const f of r.files) {
      const size = f.bytes.length;
      if (/^text\/plain/i.test(f.contentType) && size <= 512 * 1024) {
        raw.push({ title: f.filename, text: f.bytes.toString("utf8") });
        used = true;
        continue;
      }
      if (!isInlinePdf({ filename: f.filename, contentType: f.contentType, size })) continue;
      if (pdfs.length >= MAX_PDFS || inlineBytes + size > MAX_INLINE_TOTAL_BYTES) continue;
      pdfs.push({ mimeType: "application/pdf", data: f.bytes.toString("base64") });
      inlineBytes += size;
      used = true;
    }
    if (used) sourceCount += 1;
  });

  const texts = capMaterial(raw);
  if (!texts.length && !pdfs.length) return empty;
  return { texts, pdfs, sourceCount };
}
