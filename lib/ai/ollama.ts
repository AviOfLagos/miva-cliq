/**
 * Ollama backend — local (and Ollama-cloud-routed) models.
 *
 * Vercel can't reach it, so this path is dev/self-host only (AI_PROVIDER=ollama).
 * Structured output is forced with the `format` schema so the model returns clean
 * JSON instead of prose we have to scrape.
 */
const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "minimax-m3:cloud";

export function ollamaConfigured(): boolean {
  return true; // no key; available whenever it's the chosen provider
}

/**
 * Single-shot completion. `schema` (a JSON Schema object) forces structured
 * output. Returns the model's text (JSON when a schema is given), or null.
 */
export async function ollamaComplete(
  prompt: string,
  schema?: object,
): Promise<string | null> {
  const base = (process.env.OLLAMA_URL || DEFAULT_URL).replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  try {
    const r = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0 },
        ...(schema ? { format: schema } : {}),
      }),
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { response?: string } | null;
    const text = j?.response?.trim();
    return text || null;
  } catch {
    return null;
  }
}
