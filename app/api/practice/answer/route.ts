/**
 * POST /api/practice/answer  {"questionId":"42","choice":"<option text>"}
 *
 * Checks one answer on the server (by option text, so the per-serve shuffle
 * cannot matter), records the attempt for spaced repetition and Stage 4, and
 * updates the question's counters, which may confirm it.
 *
 * 200 { correct, correctOption, explanation }
 */
import { NextRequest, NextResponse } from "next/server";
import { cleanQuestionId, isCorrectChoice } from "@/lib/practice/core";
import { getQuestion, PracticeUnavailable, recordAnswer } from "@/lib/store/practice";
import { badRequest, crossSite, jsonBody, notLoggedIn, sameOrigin, studentKey, tryAgain, unavailable } from "@/lib/practice/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return crossSite();
  const student = studentKey(req);
  if (!student) return notLoggedIn();
  const body = await jsonBody(req);
  const id = cleanQuestionId(body?.questionId);
  const choice = typeof body?.choice === "string" ? body.choice.slice(0, 500) : null;
  if (!id || choice === null) return badRequest();

  try {
    const q = await getQuestion(id);
    if (!q || q.status === "hidden") {
      return NextResponse.json({ error: "That question has been taken out of practice." }, { status: 404 });
    }
    const correct = isCorrectChoice(q, choice);
    await recordAnswer(student, id, correct);
    return NextResponse.json({
      correct,
      correctOption: q.options[q.answerIndex],
      explanation: q.explanation,
    });
  } catch (e) {
    if (e instanceof PracticeUnavailable) return unavailable();
    console.error("[practice/answer] failed", (e as any)?.code ?? (e as any)?.name);
    return tryAgain();
  }
}
