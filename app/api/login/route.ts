import { NextRequest, NextResponse } from "next/server";
import { login, LoginError } from "@/lib/moodle/auth";
import { seal, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { recordUser, recordConsent } from "@/lib/store/metrics";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; agreedTerms?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const email = (body.email || "").trim();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required." },
      { status: 400 },
    );
  }
  // Consent is enforced server-side too, not just by the disabled button.
  if (body.agreedTerms !== true) {
    return NextResponse.json(
      { ok: false, error: "You must accept the Terms, Privacy Policy, and Disclaimer to continue." },
      { status: 400 },
    );
  }

  try {
    const session = await login(email, password);
    // Counts this person once, ever, via a salted hash. Awaited so the write
    // isn't cut off when the function freezes after the response.
    await recordUser(email);
    await recordConsent();
    const res = NextResponse.json({
      ok: true,
      name: session.name,
      userId: session.userId,
    });
    res.cookies.set(SESSION_COOKIE, seal(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // Tidies the cookie up in the browser. The real enforcement is the `iat`
      // check inside unseal() — this attribute is advisory and client-side.
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return res;
  } catch (e) {
    const err = e as LoginError;
    return NextResponse.json(
      { ok: false, error: err.message || "Login failed." },
      { status: err.status || 500 },
    );
  }
}
