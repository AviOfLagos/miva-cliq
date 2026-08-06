import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { listCourses } from "@/lib/moodle/courses";
import { buildPack, planPack } from "@/lib/export/coursePack";
import { rateLimit, recordRateEvent, clientIp } from "@/lib/store/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Packs fetch every document in a course, so give it the full window.
export const maxDuration = 300;

const PACKS_PER_HOUR = 12;
const HOUR = 3600;

/**
 * GET /api/export?courseId=123            -> the course pack as a .zip download
 * GET /api/export?courseId=123&plan=1     -> JSON preview of what the pack holds
 *
 * Query flags (default on): docs=0 / quizzes=0 to drop a section, open=1 to let
 * the quiz reader open (never submit) an attempt on quizzes never taken.
 */
export async function GET(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }

  const q = req.nextUrl.searchParams;
  const courseId = Number(q.get("courseId"));
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ error: "courseId required." }, { status: 400 });
  }

  let courseName: string;
  try {
    const courses = await listCourses(session);
    const course = courses.find((c) => c.id === courseId);
    if (!course) {
      return NextResponse.json({ error: "You are not enrolled in that course." }, { status: 404 });
    }
    courseName = course.fullname;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Could not read your courses." },
      { status: 502 },
    );
  }

  if (q.get("plan") === "1") {
    try {
      const plan = await planPack(session, courseId, courseName);
      return NextResponse.json({ plan });
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Could not read the course." },
        { status: 502 },
      );
    }
  }

  const ip = clientIp(req);
  const limit = await rateLimit(`ip:${ip}`, "course-pack", PACKS_PER_HOUR, HOUR);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many packs in the last hour. Try again later." },
      { status: 429 },
    );
  }

  try {
    const { zip, report } = await buildPack(session, courseId, courseName, {
      includeDocs: q.get("docs") !== "0",
      includeQuizzes: q.get("quizzes") !== "0",
      openAttempts: q.get("open") === "1",
    });
    await recordRateEvent(`ip:${ip}`, "course-pack");

    const ascii = report.filename.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-length": String(zip.length),
        "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
          report.filename,
        )}`,
        // The report rides along in a header so the client can show a summary
        // without a second request; the body must stay pure zip bytes.
        "x-pack-report": encodeURIComponent(JSON.stringify(report)),
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Could not build the pack." },
      { status: 502 },
    );
  }
}
