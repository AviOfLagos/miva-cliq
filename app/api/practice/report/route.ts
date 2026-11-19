/**
 * POST /api/practice/report  {"questionId":"42"}
 *
 * One report per student per question; three distinct reports hide it for
 * everyone. A repeat report is accepted quietly and not counted again.
 *
 * 200 { ok: true, counted, hidden }
 */
import { NextRequest, NextResponse } from "next/server";
import { cleanQuestionId } from "@/lib/practice/core";
import { getQuestion, PracticeUnavailable, reportQuestion } from "@/lib/store/practice";
import { badRequest, crossSite, jsonBody, notLoggedIn, sameOrigin, studentKey, tryAgain, unavailable } from "@/lib/practice/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return crossSite();
  const student = studentKey(req);
  if (!student) return notLoggedIn();
  const body = await jsonBody(req);
  const id = cleanQuestionId(body?.questionId);
  if (!id) return badRequest();

  try {
    const r = (await getQuestion(id)) ? await reportQuestion(student, id) : null;
    if (!r) return NextResponse.json({ error: "That question no longer exists." }, { status: 404 });
    return NextResponse.json({ ok: true, counted: r.counted, hidden: r.status === "hidden" });
  } catch (e) {
    if (e instanceof PracticeUnavailable) return unavailable();
    console.error("[practice/report] failed", (e as any)?.code ?? (e as any)?.name);
    return tryAgain();
  }
}
