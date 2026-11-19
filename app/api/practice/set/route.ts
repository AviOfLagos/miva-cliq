/**
 * POST /api/practice/set  {"courseCode":"cos202","week":3}
 *
 * A practice set of up to five questions for one course-week: missed
 * questions that are due again first, then unseen ones, then the rest, with
 * options shuffled per serve. The payload never carries the answer or the
 * explanation (toServed maps fields explicitly). POST rather than GET because
 * serving bumps a counter, and writes must prove same origin.
 *
 * 200 { courseTitle, weekTitle, week, nextWeek, bankSize, target, canGenerate, questions }
 * 404 when no student has opened this course on /study yet (no saved outline)
 * 503 { unavailable: true } when the practice tables are not there yet
 */
import { NextRequest, NextResponse } from "next/server";
import { BANK_TARGET, cleanCourseCode, cleanWeek, historiesFrom, pickSet, toServed } from "@/lib/practice/core";
import {
  attemptsFor,
  getOutline,
  markServed,
  nextOutlineWeek,
  PracticeUnavailable,
  weekBank,
} from "@/lib/store/practice";
import { badRequest, crossSite, jsonBody, notLoggedIn, sameOrigin, studentKey, tryAgain, unavailable } from "@/lib/practice/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return crossSite();
  const student = studentKey(req);
  if (!student) return notLoggedIn();
  const body = await jsonBody(req);
  const courseCode = cleanCourseCode(body?.courseCode);
  const week = cleanWeek(body?.week);
  if (!courseCode || !week) return badRequest("Pick a course week first.");

  try {
    const outline = await getOutline(courseCode, week);
    if (!outline) {
      return NextResponse.json(
        { error: "Open this course on the Study page first, then tap Practise." },
        { status: 404 },
      );
    }
    const [bank, nextWeek] = await Promise.all([weekBank(courseCode, week), nextOutlineWeek(courseCode, week)]);
    const histories = historiesFrom(await attemptsFor(student, bank.map((q) => q.id)));
    const set = pickSet(bank, histories, Date.now());
    await markServed(set.map((q) => q.id));

    return NextResponse.json({
      courseTitle: outline.courseTitle,
      weekTitle: outline.weekTitle,
      week,
      nextWeek,
      bankSize: bank.length,
      target: BANK_TARGET,
      canGenerate: bank.length < BANK_TARGET,
      questions: set.map((q) => toServed(q)),
    });
  } catch (e) {
    if (e instanceof PracticeUnavailable) return unavailable();
    console.error("[practice/set] failed", (e as any)?.code ?? (e as any)?.name);
    return tryAgain();
  }
}
