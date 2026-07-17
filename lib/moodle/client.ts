/**
 * Moodle AJAX client. Every logged-in browser action goes through
 * POST /lib/ajax/service.php?sesskey=&info=<method> with body
 *   [{ index:0, methodname:<method>, args:{...} }]
 * Response is [{ error:bool, data?, exception? }].
 */
import { LMS, cookieHeader, type MoodleSession } from "./auth";

export interface AjaxResult<T = any> {
  error: boolean;
  data?: T;
  exception?: { message: string; errorcode?: string };
}

export async function ajax<T = any>(
  session: MoodleSession,
  methodname: string,
  args: Record<string, unknown>,
): Promise<AjaxResult<T>> {
  const url = `${LMS}/lib/ajax/service.php?sesskey=${encodeURIComponent(
    session.sesskey,
  )}&info=${encodeURIComponent(methodname)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie: cookieHeader(session.cookies),
    },
    body: JSON.stringify([{ index: 0, methodname, args }]),
  });
  const j = (await r.json().catch(() => null)) as AjaxResult<T>[] | null;
  if (!j || !j[0]) {
    return { error: true, exception: { message: `Bad AJAX response (${r.status})` } };
  }
  return j[0];
}
