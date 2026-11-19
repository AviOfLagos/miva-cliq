import { NextRequest } from "next/server";
import { getLmsSession } from "@/lib/identity";
import { runCourse } from "@/lib/completion/engine";
import { tallyOutcome, recordOutcomes, type OutcomeTally } from "@/lib/store/completionStats";

export const runtime = "nodejs";
// One pass over one course per request. 60s is the Vercel free-tier cap; the
// engine stops taking new work at ~45s and reports what is left, and the client
// calls again for the same course (see runAll in lib/run/AppContext.tsx).
export const maxDuration = 60;

/** Bound on the client-supplied list of already-settled activity ids. */
const MAX_SETTLED = 5000;

/**
 * Server-Sent-Events stream for one pass over a single course.
 *
 * Body: { courseId, courseName?, forumTexts?, answerQuizzes?, settled?: number[] }
 *   settled = cmids an earlier pass already reported (skipped on this pass).
 *
 * Events:
 *   event: progress  data:{courseId,cmid,name,modname,status,detail,reason,retry?,index,total}
 *   event: done      data:{courseId,summary:{done,already,skipped,failed,total,remaining,locked,failures}}
 *   event: error     data:{message}
 */
export async function POST(req: NextRequest) {
  const session = await getLmsSession(req);
  if (!session) {
    return new Response("event: error\ndata: {\"message\":\"Not logged in.\"}\n\n", {
      status: 401,
      headers: { "content-type": "text/event-stream" },
    });
  }

  let courseId: number;
  let forumTexts: string[] = [];
  let answerQuizzes = false;
  let courseName: string | null = null;
  let settled: number[] = [];
  try {
    const body = await req.json();
    courseId = Number(body.courseId);
    if (!courseId) throw new Error("courseId required");
    if (Array.isArray(body.forumTexts)) {
      forumTexts = body.forumTexts
        .filter((t: unknown): t is string => typeof t === "string")
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0)
        .slice(0, 20);
    }
    answerQuizzes = body.answerQuizzes === true;
    if (typeof body.courseName === "string") courseName = body.courseName;
    if (Array.isArray(body.settled)) {
      settled = body.settled
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n > 0)
        .slice(0, MAX_SETTLED);
    }
  } catch {
    return new Response("event: error\ndata: {\"message\":\"Invalid request.\"}\n\n", {
      status: 400,
      headers: { "content-type": "text/event-stream" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      const tally: OutcomeTally = new Map();
      try {
        const summary = await runCourse(
          session,
          courseId,
          (e) => {
            // Locked items are re-reported every pass until they open up; count
            // them on the first pass only, so the counter means "found locked".
            if (!e.retry || settled.length === 0) tallyOutcome(tally, e);
            send("progress", e);
          },
          { forumTexts, answerQuizzes, courseName, settled },
        );
        send("done", { courseId, summary });
      } catch (e: any) {
        send("error", { message: e?.message || "Run failed." });
      } finally {
        // One telemetry write per pass, after the client already has its answer.
        await recordOutcomes(tally).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
