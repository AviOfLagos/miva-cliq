import { NextRequest } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { runCourse } from "@/lib/completion/engine";

export const runtime = "nodejs";
export const maxDuration = 300; // long-running; one course per request keeps it bounded

/**
 * Server-Sent-Events stream for a single course. The client loops its selected
 * courses and opens one stream each, so no single request runs unbounded.
 *
 * Events:
 *   event: progress  data:{courseId,cmid,name,modname,status,detail,index,total}
 *   event: done      data:{courseId,summary:{...}}
 *   event: error     data:{message}
 */
export async function POST(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return new Response("event: error\ndata: {\"message\":\"Not logged in.\"}\n\n", {
      status: 401,
      headers: { "content-type": "text/event-stream" },
    });
  }

  let courseId: number;
  try {
    const body = await req.json();
    courseId = Number(body.courseId);
    if (!courseId) throw new Error("courseId required");
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
      try {
        const summary = await runCourse(session, courseId, (e) =>
          send("progress", e),
        );
        send("done", { courseId, summary });
      } catch (e: any) {
        send("error", { message: e?.message || "Run failed." });
      } finally {
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
