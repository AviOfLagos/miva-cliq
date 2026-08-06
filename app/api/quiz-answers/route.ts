import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { rateLimit, recordRateEvent, clientIp } from "@/lib/store/rateLimit";
import { storeEnabled } from "@/lib/store/db";
import { isDepartment } from "@/lib/taxonomy";
import {
  listAnswers,
  editAnswer,
  confirmAnswer,
  refuteAnswer,
} from "@/lib/store/quizAnswers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITS_PER_HOUR = 20;
const HOUR = 3600;

/** Public read: the shared answer bank is browsable by anyone. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const courseCode = q.get("courseCode")?.trim().toLowerCase() || null;
  const department = isDepartment(q.get("department")) ? q.get("department") : null;
  // Guard the presence of the param first: Number(null) === 0, so a missing
  // ?section would otherwise filter to section 0 and match nothing.
  const sectionParam = q.get("section");
  const sectionNum = sectionParam !== null && sectionParam !== "" ? Number(sectionParam) : NaN;
  const section = Number.isInteger(sectionNum) ? sectionNum : null;
  const beforeParam = q.get("before");
  const beforeNum = beforeParam ? Number(beforeParam) : NaN;
  const before = Number.isFinite(beforeNum) && beforeNum > 0 ? beforeNum : null;

  const answers = await listAnswers({ courseCode, department, section, before });
  return NextResponse.json({
    answers,
    enabled: storeEnabled(),
    nextBefore: answers.length ? answers[answers.length - 1].updatedAt : null,
  });
}

/**
 * Wiki-style edit / vote. Login-gated (anonymous to readers, known to the rate
 * limiter). action: "edit" (set the answer) | "confirm" | "refute".
 */
export async function PUT(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Log in to edit answers." }, { status: 401 });
  }
  if (!storeEnabled()) {
    return NextResponse.json({ error: "Answer bank unavailable." }, { status: 503 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const hash = typeof payload?.questionHash === "string" ? payload.questionHash : "";
  const action = payload?.action;
  if (!hash) return NextResponse.json({ error: "questionHash required." }, { status: 400 });

  const authorHash = sessionAuthorHash(session);
  const ip = clientIp(req);
  const limit = await rateLimit(`ip:${ip}`, "quiz-edit", EDITS_PER_HOUR, HOUR);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many edits. Slow down." }, { status: 429 });
  }

  let result;
  if (action === "confirm") {
    result = await confirmAnswer(hash);
  } else if (action === "refute") {
    result = await refuteAnswer(hash);
  } else if (action === "edit") {
    const answerText = typeof payload?.answerText === "string" ? payload.answerText : "";
    if (!answerText.trim()) {
      return NextResponse.json({ error: "answerText required." }, { status: 400 });
    }
    result = await editAnswer(hash, answerText, authorHash);
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  if (!result) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await recordRateEvent(`ip:${ip}`, "quiz-edit");
  return NextResponse.json({ answer: result });
}
