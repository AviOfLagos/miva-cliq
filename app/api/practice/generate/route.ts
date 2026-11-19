/**
 * POST /api/practice/generate  {"courseCode":"cos202","week":3,"courseId":1234}
 * Header: x-gemini-key: <the student's own Gemini API key>
 *
 * For a course-week whose bank holds fewer than BANK_TARGET usable questions,
 * asks Gemini (with the student's key, for this one call) for enough questions
 * to reach the target in that one call (20 for an empty week, else the
 * shortfall rounded up to ten), validates each one and saves the survivors for everyone. What the batch is
 * written from, best first:
 *
 *   1. Saved week notes: no LMS access at all.
 *   2. The week's real material, when the student is connected to the LMS and
 *      enrolled in `courseId`: page text and small PDFs are gathered here,
 *      server-side, and ONE call returns condensed notes plus the questions.
 *      The notes are saved; the material is not.
 *   3. The saved outline's titles, as before.
 *
 * The key is not stored, logged or echoed, and there is no fallback to the
 * server's own key.
 *
 * 200 { added, bankSize, source }
 * 400 { needsKey } no key sent / { keyError: "invalid_key" } Google refused it
 * 409 { full } the week already has enough questions
 * 429 rate limited by us, or { keyError: "quota" } by Google
 */
import { NextRequest, NextResponse } from "next/server";
import { geminiCompleteWithKey } from "@/lib/ai/gemini";
import { BANK_TARGET, batchSizeFor, cleanCourseCode, cleanWeek, parseBatchText, validateBatch } from "@/lib/practice/core";
import {
  BATCH_SCHEMA,
  buildGenerationPrompt,
  buildMaterialPrompt,
  buildNotesPrompt,
  classifyGeminiError,
  KEY_ERROR_MESSAGES,
  NOTES_BATCH_SCHEMA,
} from "@/lib/practice/generate";
import { cleanNotes } from "@/lib/practice/material";
import { enrolledCourse, gatherWeekMaterial } from "@/lib/practice/gather";
import { BURST_SECONDS, DAY_SECONDS, generationVerdict, LIMIT_MESSAGES } from "@/lib/practice/limits";
import {
  getOutline,
  getWeekNotes,
  insertQuestions,
  PracticeUnavailable,
  saveWeekNotes,
  weekBank,
  weekHashes,
} from "@/lib/store/practice";
import { rateCounts, recordRateEvent } from "@/lib/store/rateLimit";
import { getLmsSession } from "@/lib/identity";
import {
  badRequest,
  crossSite,
  geminiKeyFrom,
  jsonBody,
  notLoggedIn,
  sameOrigin,
  studentKey,
  tryAgain,
  unavailable,
} from "@/lib/practice/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leave a margin under maxDuration for the saves and the response. */
const BUDGET_MS = 54_000;
/** The LMS gather may use at most this much of the budget. */
const GATHER_MS = 16_000;
/** Never give Gemini less than this; if the budget is that tight, skip the gather. */
const MIN_MODEL_MS = 25_000;
/**
 * Room for notes plus 20 questions with explanations (~5k tokens of answer)
 * and the thinking budget gemini-flash-latest spends first. 8192 could cut a
 * 20-question batch short; a cut-off batch still keeps its complete questions
 * (parseBatchText salvages them).
 */
const MAX_OUTPUT_TOKENS = 24_576;

function cleanCourseId(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n < 1e9 ? n : null;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  if (!sameOrigin(req)) return crossSite();
  const student = await studentKey(req);
  if (!student) return notLoggedIn();
  const body = await jsonBody(req);
  const courseCode = cleanCourseCode(body?.courseCode);
  const week = cleanWeek(body?.week);
  const courseId = cleanCourseId(body?.courseId);
  if (!courseCode || !week) return badRequest("Pick a course week first.");
  const key = geminiKeyFrom(req);
  if (!key) {
    return NextResponse.json(
      { error: "Add your free Gemini key to create questions for this week.", needsKey: true },
      { status: 400 },
    );
  }

  try {
    const outline = await getOutline(courseCode, week);
    if (!outline) {
      return NextResponse.json(
        { error: "Open this course on the Study page first, then tap Practise." },
        { status: 404 },
      );
    }
    const [bank, hashes, notes] = await Promise.all([
      weekBank(courseCode, week),
      weekHashes(courseCode, week),
      getWeekNotes(courseCode, week),
    ]);
    // Generation budget goes to thin weeks only.
    if (bank.length >= BANK_TARGET) {
      return NextResponse.json(
        { error: "This week already has plenty of questions.", full: true, bankSize: bank.length },
        { status: 409 },
      );
    }

    const [burst, day] = await rateCounts(student, "practice-gen", [BURST_SECONDS, DAY_SECONDS]);
    const verdict = generationVerdict({ burst, day });
    if (!verdict.ok) {
      return NextResponse.json({ error: LIMIT_MESSAGES[verdict.reason], limited: verdict.reason }, { status: 429 });
    }

    const existing = bank.map((q) => q.question);
    const count = batchSizeFor(bank.length);
    let prompt: string;
    let schema: object = BATCH_SCHEMA;
    let inline: { mimeType: string; data: string }[] = [];
    let source: "notes" | "material" | "outline" = "outline";
    let sourceCount = 0;

    if (notes) {
      prompt = buildNotesPrompt(outline, notes, count, existing);
      source = "notes";
    } else {
      prompt = buildGenerationPrompt(outline, count, existing);
      const session = courseId ? await getLmsSession(req) : null;
      if (session && courseId) {
        const gatherEnd = Math.min(started + GATHER_MS, started + BUDGET_MS - MIN_MODEL_MS);
        if (await enrolledCourse(session, courseId, courseCode, gatherEnd)) {
          const m = await gatherWeekMaterial(session, courseId, week, gatherEnd);
          if (m.texts.length || m.pdfs.length) {
            prompt = buildMaterialPrompt(outline, { texts: m.texts, pdfCount: m.pdfs.length }, count, existing);
            schema = NOTES_BATCH_SCHEMA;
            inline = m.pdfs;
            source = "material";
            sourceCount = m.sourceCount;
          }
        }
      }
    }

    const timeoutMs = Math.max(MIN_MODEL_MS, started + BUDGET_MS - Date.now());
    const result = await geminiCompleteWithKey(key, prompt, { schema, inline, timeoutMs, maxOutputTokens: MAX_OUTPUT_TOKENS });
    inline = [];
    // Count every call made with the key, successful or not: the limit protects their quota too.
    await recordRateEvent(student, "practice-gen");

    if (!result.ok) {
      const kind = result.httpStatus === 0 ? "unavailable" : classifyGeminiError(result.httpStatus, result.body);
      const status = kind === "invalid_key" ? 400 : kind === "quota" ? 429 : 502;
      return NextResponse.json({ error: KEY_ERROR_MESSAGES[kind], keyError: kind }, { status });
    }

    const parsed = parseBatchText(result.text);
    if (source === "material") {
      const weekNotes = cleanNotes((parsed as any)?.notes);
      if (weekNotes) await saveWeekNotes(courseCode, week, weekNotes, sourceCount, student);
    }
    const valid = validateBatch(parsed, hashes, count * 2);
    const added = await insertQuestions(courseCode, week, student, valid);
    if (!added) {
      return NextResponse.json({ error: KEY_ERROR_MESSAGES.failed, keyError: "failed" }, { status: 502 });
    }
    return NextResponse.json({ added, bankSize: bank.length + added, source });
  } catch (e) {
    if (e instanceof PracticeUnavailable) return unavailable();
    // Deliberately no error object: nothing that could carry request details goes to the logs.
    console.error("[practice/generate] failed", (e as any)?.code ?? (e as any)?.name);
    return tryAgain();
  }
}
