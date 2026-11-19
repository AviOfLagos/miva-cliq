/**
 * Google Gemini backend — production default (Ollama can't run on Vercel).
 *
 * Uses JSON-schema structured output so the model returns clean JSON. Retries on
 * 429 (free tier is easily rate-limited) with a short backoff.
 */
const API = "https://generativelanguage.googleapis.com/v1beta/models";
// Auto-updating alias: pinned versions (gemini-1.5-flash, gemini-2.5-flash) get
// retired / blocked for new keys and 404. Override with GEMINI_MODEL if needed.
const DEFAULT_MODEL = "gemini-flash-latest";

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Convert a plain JSON Schema to Gemini's UPPERCASE-typed schema form. */
function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "type" && typeof v === "string") out.type = v.toUpperCase();
    else if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]),
      );
    } else if (k === "items") out.items = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

/**
 * Single-shot completion. `schema` (plain JSON Schema) forces JSON output.
 * gemini-flash-latest is a thinking model — it spends output tokens reasoning
 * before answering, so the budget must be generous (1024) or the text comes back
 * empty with finishReason MAX_TOKENS.
 */
export async function geminiComplete(
  prompt: string,
  schema?: object,
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const generationConfig: any = { temperature: 0, maxOutputTokens: 1024 };
  if (schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(schema);
  }
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(
        `${API}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body },
      );
      if (r.status === 429 || r.status >= 500) {
        await sleep(600 * (attempt + 1)); // back off and retry
        continue;
      }
      if (!r.ok) return null;
      const j = (await r.json().catch(() => null)) as any;
      const text: string | undefined = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      return text?.trim() || null;
    } catch {
      await sleep(400 * (attempt + 1));
    }
  }
  return null;
}

export type KeyedResult =
  | { ok: true; text: string }
  /** httpStatus 0 = network error or timeout. `body` is Google's parsed error, for classification only: never log or echo it. */
  | { ok: false; httpStatus: number; body: unknown };

/**
 * One completion with a key the caller supplies (a student's own key), not the
 * server's. The key goes in the x-goog-api-key header rather than the URL, so it
 * cannot turn up in a logged URL, and it is not kept, logged or returned.
 * No retry on 429: with a student's free key that is their quota, and the
 * caller maps it to a plain message instead.
 */
export async function geminiCompleteWithKey(
  key: string,
  prompt: string,
  opts: {
    schema?: object;
    maxOutputTokens?: number;
    temperature?: number;
    /** Total time for the call, the one 5xx retry included, so a route can stay inside maxDuration. */
    timeoutMs?: number;
    /** Files sent with the prompt (small PDFs), base64-encoded. Never logged. */
    inline?: { mimeType: string; data: string }[];
  } = {},
): Promise<KeyedResult> {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const generationConfig: any = {
    temperature: opts.temperature ?? 0.7,
    maxOutputTokens: opts.maxOutputTokens ?? 8192,
  };
  if (opts.schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(opts.schema);
  }
  const parts: object[] = [
    ...(opts.inline ?? []).map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } })),
    { text: prompt },
  ];
  const body = JSON.stringify({ contents: [{ parts }], generationConfig });
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 45_000);

  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try {
      r = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        cache: "no-store",
        signal,
      });
    } catch {
      return { ok: false, httpStatus: 0, body: null };
    }
    if (r.status >= 500 && attempt === 0) {
      await sleep(800);
      continue;
    }
    const j = (await r.json().catch(() => null)) as any;
    if (!r.ok) return { ok: false, httpStatus: r.status, body: j };
    const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => !p?.thought)
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();
    return text ? { ok: true, text } : { ok: false, httpStatus: 200, body: null };
  }
  return { ok: false, httpStatus: 503, body: null };
}
