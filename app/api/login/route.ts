import { NextRequest, NextResponse } from "next/server";
import { login, LoginError } from "@/lib/moodle/auth";
import { seal, SESSION_COOKIE } from "@/lib/session";
import { recordUser } from "@/lib/store/metrics";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
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

  try {
    const session = await login(email, password);
    // Counts this person once, ever, via a salted hash. Awaited so the write
    // isn't cut off when the function freezes after the response.
    await recordUser(email);
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
      maxAge: 60 * 60 * 2, // 2h — matches Moodle session lifetime roughly
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
