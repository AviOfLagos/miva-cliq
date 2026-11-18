/**
 * Moodle AJAX client. Every logged-in browser action goes through
 * POST /lib/ajax/service.php?sesskey=&info=<method> with body
 *   [{ index:0, methodname:<method>, args:{...} }, { index:1, ... }, ...]
 * Response is [{ error:bool, data?, exception? }, ...], one per call, in order.
 *
 * Moodle stops processing a batch at the first call that errors: the response
 * then holds results up to and including the failing call, and nothing for the
 * rest. `ajaxBatch` always returns one result per call; calls Moodle did not
 * get to come back as `{ error: true, exception: { errorcode: NOT_PROCESSED } }`
 * so the caller can resubmit them.
 */
import { LMS, cookieHeader, type MoodleSession } from "./auth";

export interface AjaxResult<T = any> {
  error: boolean;
  data?: T;
  exception?: { message: string; errorcode?: string };
}

export interface AjaxCall {
  methodname: string;
  args: Record<string, unknown>;
}

/** errorcode on a result Moodle never produced (batch cut short / bad shape). */
export const NOT_PROCESSED = "miva_cliq_not_processed";

/** A single AJAX request should never be allowed to eat the whole run. */
const AJAX_TIMEOUT_MS = 20_000;

function missing(message: string): AjaxResult {
  return { error: true, exception: { message, errorcode: NOT_PROCESSED } };
}

function isResult(x: unknown): x is AjaxResult {
  return !!x && typeof x === "object" && typeof (x as any).error === "boolean";
}

export async function ajaxBatch(
  session: MoodleSession,
  calls: AjaxCall[],
): Promise<AjaxResult[]> {
  if (calls.length === 0) return [];
  const info = calls.length === 1 ? calls[0].methodname : `${calls[0].methodname},+${calls.length - 1}`;
  const url = `${LMS}/lib/ajax/service.php?sesskey=${encodeURIComponent(
    session.sesskey,
  )}&info=${encodeURIComponent(info)}`;

  let j: unknown = null;
  let status = 0;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        cookie: cookieHeader(session.cookies),
      },
      body: JSON.stringify(
        calls.map((c, index) => ({ index, methodname: c.methodname, args: c.args })),
      ),
      signal: AbortSignal.timeout(AJAX_TIMEOUT_MS),
    });
    status = r.status;
    j = await r.json().catch(() => null);
  } catch (e: any) {
    return calls.map(() => missing(`AJAX request failed (${e?.name || "error"})`));
  }

  // A whole-request failure (bad sesskey, expired login) can come back as one
  // error object rather than an array. Apply it to every call: nothing ran.
  if (isResult(j)) {
    return calls.map(() => ({ ...j as AjaxResult }));
  }
  const arr = Array.isArray(j) ? j : [];
  return calls.map((_, i) =>
    isResult(arr[i]) ? (arr[i] as AjaxResult) : missing(`Bad AJAX response (${status})`),
  );
}

export async function ajax<T = any>(
  session: MoodleSession,
  methodname: string,
  args: Record<string, unknown>,
): Promise<AjaxResult<T>> {
  const [res] = await ajaxBatch(session, [{ methodname, args }]);
  return res as AjaxResult<T>;
}
