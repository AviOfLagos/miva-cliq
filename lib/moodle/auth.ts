/**
 * Browserless Miva CAS + Moodle login.
 *
 * Reverse-engineered flow (see PROBE-FINDINGS.md):
 *   1. POST sis-be/auth/login  (needs x-origin-portal: student) -> access + refresh token
 *   2. POST sis/cas/generateServiceTicket {service, access_token, refresh_token} -> ticket
 *   3. GET  lms login?...&ticket=  (follow redirects, collect cookies) -> MoodleSession
 *   4. GET  /my/  -> scrape sesskey + userId
 *
 * Returns a MoodleSession = the cookie jar + sesskey needed for every downstream call.
 */

export const LMS = "https://lms.miva.university";
const SIS = "https://sis.miva.university";
const SIS_BE = "https://sis-be.miva.university";
const SERVICE = `${LMS}/login/index.php?authCASattras=CASattras`;

const PORTAL_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json, text/plain, */*",
  origin: SIS,
  referer: `${SIS}/`,
  "x-origin-portal": "student",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
};

export interface MoodleSession {
  cookies: Record<string, string>;
  sesskey: string;
  userId: number;
  name: string;
}

export class LoginError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
    this.name = "LoginError";
  }
}

function mergeSetCookies(jar: Record<string, string>, res: Response): void {
  // Node 18+/undici exposes getSetCookie(); fall back to single header.
  const raw =
    typeof (res.headers as any).getSetCookie === "function"
      ? (res.headers as any).getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  for (const c of raw) {
    const pair = c.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}

function friendlyNameFromEmail(email: string): string {
  const local = (email.split("@")[0] || "").split(/[._-]/)[0];
  if (!local) return "there";
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
}

export function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function login(
  email: string,
  password: string,
): Promise<MoodleSession> {
  // 1) credential exchange -> tokens
  let r = await fetch(`${SIS_BE}/auth/login`, {
    method: "POST",
    headers: PORTAL_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 401) {
    throw new LoginError("Incorrect email or password.");
  }
  if (!r.ok) {
    throw new LoginError(`Login service error (${r.status}).`, 502);
  }
  const auth = (await r.json().catch(() => ({}))) as any;
  const accessToken = auth?.data?.access_token;
  const refreshToken = auth?.data?.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new LoginError("Login succeeded but no session token was returned.", 502);
  }

  // 2) CAS service ticket
  r = await fetch(`${SIS}/cas/generateServiceTicket`, {
    method: "POST",
    headers: PORTAL_HEADERS,
    body: JSON.stringify({
      service: SERVICE,
      access_token: accessToken,
      refresh_token: refreshToken,
    }),
  });
  if (!r.ok) {
    throw new LoginError(`Could not obtain CAS ticket (${r.status}).`, 502);
  }
  const ticketBody = await r.text();
  let ticket: string;
  try {
    const j = JSON.parse(ticketBody);
    ticket = j.ticket || j.serviceTicket || String(j.data || ticketBody);
  } catch {
    ticket = ticketBody.trim().replace(/^"|"$/g, "");
  }
  if (!ticket || !ticket.startsWith("ST-")) {
    throw new LoginError("Invalid CAS ticket.", 502);
  }

  // 3) consume ticket at Moodle -> session cookies (follow redirects manually)
  const jar: Record<string, string> = {};
  let url = `${SERVICE}&ticket=${encodeURIComponent(ticket)}`;
  for (let hop = 0; hop < 8; hop++) {
    r = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { cookie: cookieHeader(jar) },
    });
    mergeSetCookies(jar, r);
    const loc = r.headers.get("location");
    if (!loc) break;
    url = loc.startsWith("http") ? loc : new URL(loc, url).href;
  }
  if (!Object.keys(jar).some((k) => /MoodleSession/i.test(k))) {
    throw new LoginError("Moodle did not establish a session.", 502);
  }

  // 4) scrape sesskey + identity
  r = await fetch(`${LMS}/my/`, { headers: { cookie: cookieHeader(jar) } });
  const html = await r.text();
  const sesskey = html.match(/"sesskey":"([^"]+)"/)?.[1];
  const userId = html.match(/"userId":(\d+)/)?.[1];
  // The dashboard renders the real name client-side (server HTML only has a
  // "Hi, there" placeholder), and no name claim exists in the token — so derive a
  // friendly name from the email local-part (e.g. david.olatunji -> David).
  const scraped = html.match(/"fullname":"([^"]+)"/)?.[1];
  const name =
    scraped && scraped.toLowerCase() !== "there"
      ? scraped
      : friendlyNameFromEmail(email);
  if (!sesskey) {
    throw new LoginError("Logged in but could not read Moodle sesskey.", 502);
  }

  return { cookies: jar, sesskey, userId: Number(userId || 0), name };
}
