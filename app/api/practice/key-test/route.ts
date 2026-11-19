/**
 * POST /api/practice/key-test
 * Header: x-gemini-key: <the student's own Gemini API key>
 *
 * One tiny Gemini call to check a pasted key works. The key is used for this
 * call only: not stored, logged or echoed.
 *
 * 200 { ok: true } / 4xx-5xx { error, keyError }
 */
import { NextRequest, NextResponse } from "next/server";
import { geminiCompleteWithKey } from "@/lib/ai/gemini";
import { classifyGeminiError, KEY_ERROR_MESSAGES } from "@/lib/practice/generate";
import { rateLimit, recordRateEvent } from "@/lib/store/rateLimit";
import { crossSite, geminiKeyFrom, notLoggedIn, sameOrigin, studentKey } from "@/lib/practice/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TESTS_PER_HOUR = 10;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return crossSite();
  // Login-gated so this can't be used as an open key checker.
  const student = await studentKey(req);
  if (!student) return notLoggedIn();
  const key = geminiKeyFrom(req);
  if (!key) {
    return NextResponse.json(
      { error: "That doesn't look like a Gemini key. It usually starts with AIza and is 39 characters long.", keyError: "invalid_key" },
      { status: 400 },
    );
  }
  const limit = await rateLimit(student, "practice-keytest", TESTS_PER_HOUR, 3600);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many tests this hour. Try again later." }, { status: 429 });
  }

  const r = await geminiCompleteWithKey(key, 'Reply with the JSON {"ok":true}.', {
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    temperature: 0,
    maxOutputTokens: 512,
    timeoutMs: 20_000,
  });
  await recordRateEvent(student, "practice-keytest");

  // Any successful answer proves the key, even an empty one (thinking used the budget).
  if (r.ok || r.httpStatus === 200) return NextResponse.json({ ok: true });
  const kind = r.httpStatus === 0 ? "unavailable" : classifyGeminiError(r.httpStatus, r.body);
  const status = kind === "invalid_key" ? 400 : kind === "quota" ? 429 : 502;
  return NextResponse.json({ error: KEY_ERROR_MESSAGES[kind], keyError: kind }, { status });
}
