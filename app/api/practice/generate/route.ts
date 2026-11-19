/**
 * POST /api/practice/generate  {"courseCode":"cos202","week":3}
 * Header: x-gemini-key: <the student's own Gemini API key>
 *
 * For a course-week whose bank holds fewer than BANK_TARGET usable questions,
 * asks Gemini (with the student's key, for this one call) for a batch of ten
 * from the saved outline, validates each one and saves the survivors for
 * everyone. The key is not stored, logged or echoed, and there is no fallback
 * to the server's own key.
 *
 * 200 { added, bankSize }
 * 400 { needsKey } no key sent / { keyError: "invalid_key" } Google refused it
 * 409 { full } the week already has enough questions
 * 429 rate limited by us, or { keyError: "quota" } by Google
 */
import { NextRequest, NextResponse } from "next/server";
import { geminiCompleteWithKey } from "@/lib/ai/gemini";
import { BANK_TARGET, cleanCourseCode, cleanWeek, parseBatchText, validateBatch } from "@/lib/practice/core";
import { BATCH_SCHEMA, buildGenerationPrompt, classifyGeminiError, KEY_ERROR_MESSAGES } from "@/lib/practice/generate";
import { getOutline, insertQuestions, PracticeUnavailable, weekBank, weekHashes } from "@/lib/store/practice";
import { rateLimit, recordRateEvent } from "@/lib/store/rateLimit";
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

const GENERATIONS_PER_HOUR = 6;
const HOUR = 3600;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return crossSite();
  const student = studentKey(req);
  if (!student) return notLoggedIn();
  const body = await jsonBody(req);
  const courseCode = cleanCourseCode(body?.courseCode);
  const week = cleanWeek(body?.week);
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
    const [bank, hashes] = await Promise.all([weekBank(courseCode, week), weekHashes(courseCode, week)]);
    // Generation budget goes to thin weeks only.
    if (bank.length >= BANK_TARGET) {
      return NextResponse.json(
        { error: "This week already has plenty of questions.", full: true, bankSize: bank.length },
        { status: 409 },
      );
    }

    const limit = await rateLimit(student, "practice-gen", GENERATIONS_PER_HOUR, HOUR);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "You've created a lot of questions this hour. Practise these, and try again later." },
        { status: 429 },
      );
    }

    const result = await geminiCompleteWithKey(key, buildGenerationPrompt(outline), { schema: BATCH_SCHEMA });
    // Count every call made with the key, successful or not: the limit protects their quota too.
    await recordRateEvent(student, "practice-gen");

    if (!result.ok) {
      const kind = result.httpStatus === 0 ? "unavailable" : classifyGeminiError(result.httpStatus, result.body);
      const status = kind === "invalid_key" ? 400 : kind === "quota" ? 429 : 502;
      return NextResponse.json({ error: KEY_ERROR_MESSAGES[kind], keyError: kind }, { status });
    }

    const valid = validateBatch(parseBatchText(result.text), hashes);
    const added = await insertQuestions(courseCode, week, student, valid);
    if (!added) {
      return NextResponse.json({ error: KEY_ERROR_MESSAGES.failed, keyError: "failed" }, { status: 502 });
    }
    return NextResponse.json({ added, bankSize: bank.length + added });
  } catch (e) {
    if (e instanceof PracticeUnavailable) return unavailable();
    // Deliberately no error object: nothing that could carry request details goes to the logs.
    console.error("[practice/generate] failed", (e as any)?.code ?? (e as any)?.name);
    return tryAgain();
  }
}
