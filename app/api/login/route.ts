import { NextRequest, NextResponse } from "next/server";
import { login, LoginError } from "@/lib/moodle/auth";
import { seal, SESSION_COOKIE } from "@/lib/session";
import { recordUser, recordConsent } from "@/lib/store/metrics";
import { rateLimit, recordRateEvent, clientIp } from "@/lib/store/rateLimit";
import { authorHash } from "@/lib/store/authorHash";

export const runtime = "nodejs";
export const maxDuration = 30;

// Two limits, because either alone is trivially bypassed: an attacker with a
// pool of IPs walks past a per-IP cap, and one targeting many accounts from a
// single host walks past a per-account cap.
const PER_IP_LIMIT = 10;
const PER_ACCOUNT_LIMIT = 5;
const WINDOW_SECONDS = 15 * 60;

/**
 * Rate-limit key for an account. Hashed, never the raw address — keying on the
 * email itself would put every address that has ever been guessed at into
 * rate_events, which is exactly the data this project promises not to hold.
 *
 * authorHash throws without a salt configured. Returning null there degrades to
 * IP-only limiting rather than taking login down.
 */
function accountKey(email: string): string | null {
  try {
    return `acct:${authorHash(email)}`;
  } catch {
    return null;
  }
}

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

  const ipKey = `ip:${clientIp(req)}`;
  const acctKey = accountKey(email);
  const [ipVerdict, acctVerdict] = await Promise.all([
    rateLimit(ipKey, "login", PER_IP_LIMIT, WINDOW_SECONDS),
    acctKey
      ? rateLimit(acctKey, "login", PER_ACCOUNT_LIMIT, WINDOW_SECONDS)
      : Promise.resolve({ ok: true, remaining: PER_ACCOUNT_LIMIT }),
  ]);
  if (!ipVerdict.ok || !acctVerdict.ok) {
    // Deliberately does not say which limit tripped. "Too many attempts for
    // this account" would confirm the address exists to someone enumerating.
    return NextResponse.json(
      { ok: false, error: "Too many login attempts. Try again in a few minutes." },
      { status: 429 },
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
      maxAge: 60 * 60 * 2, // 2h — matches Moodle session lifetime roughly
    });
    return res;
  } catch (e) {
    const err = e as LoginError;
    const status = err.status || 500;
    // Count rejected credentials only. A 5xx means Miva's portal is unwell —
    // locking users out of a service that is already struggling helps nobody,
    // and a successful login costs nothing against the limit, so someone with
    // several devices is never penalised for their own valid logins.
    if (status === 401 || status === 403) {
      await Promise.all([
        recordRateEvent(ipKey, "login"),
        acctKey ? recordRateEvent(acctKey, "login") : Promise.resolve(),
      ]);
    }
    return NextResponse.json(
      { ok: false, error: err.message || "Login failed." },
      { status },
    );
  }
}
