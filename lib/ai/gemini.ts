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
