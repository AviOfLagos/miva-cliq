/**
 * Request helpers every practice route goes through, so identity, the
 * same-origin check and the student's Gemini key are each read in one place.
 */
import { NextRequest, NextResponse } from "next/server";
import { unseal, SESSION_COOKIE } from "@/lib/session";
import { sessionAuthorHash } from "@/lib/store/authorHash";
import { isSameOrigin } from "@/lib/http/sameOrigin";
import { cleanApiKey } from "./core";

/**
 * The anonymous per-student key: the salted HMAC of the Moodle user id from the
 * sealed session, exactly as the gists routes derive it. When a longer-lived
 * identity cookie lands, swap the body of this function and nothing else.
 */
export function studentKey(req: NextRequest): string | null {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  return session ? sessionAuthorHash(session) : null;
}

/** Header the browser sends the student's own Gemini key in. Never logged, stored or echoed. */
export const GEMINI_KEY_HEADER = "x-gemini-key";

export function geminiKeyFrom(req: NextRequest): string | null {
  return cleanApiKey(req.headers.get(GEMINI_KEY_HEADER));
}

export function sameOrigin(req: NextRequest): boolean {
  return isSameOrigin({
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    host: req.headers.get("x-forwarded-host") || req.headers.get("host"),
  });
}

/* Fixed responses, shared so every route words them the same way. */
export const crossSite = () => NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
export const notLoggedIn = () =>
  NextResponse.json({ error: "Log in with your Miva account to practise." }, { status: 401 });
export const unavailable = () =>
  NextResponse.json(
    { error: "Practice isn't available yet. Your study prompts still work.", unavailable: true },
    { status: 503 },
  );
export const badRequest = (error = "Invalid request.") => NextResponse.json({ error }, { status: 400 });
export const tryAgain = () =>
  NextResponse.json({ error: "Something went wrong on our side. Try again in a minute." }, { status: 500 });

export async function jsonBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
