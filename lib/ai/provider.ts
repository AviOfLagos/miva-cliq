/**
 * AI provider abstraction for answering option-based quiz questions.
 *
 * Provider is chosen by env:
 *   AI_PROVIDER=ollama  -> local / Ollama-cloud model (dev; unreachable from Vercel)
 *   AI_PROVIDER=gemini  -> Google Gemini (prod default)
 * If unset, prefer Gemini when GEMINI_API_KEY is present, else Ollama.
 *
 * Structured output is schema-forced on both backends, so we get clean
 * {"indices":[...]} instead of prose. The model returns option INDICES, which the
 * runner maps to option text — no fuzzy matching of a paraphrased answer.
 */
import { ollamaComplete, ollamaConfigured } from "./ollama";
import { geminiComplete, geminiConfigured } from "./gemini";

export type McqQuestion = {
  question: string;
  options: string[];
  multiple?: boolean;
};

/** Chosen 0-based option indices. Empty = the model declined / parse failed. */
export type McqAnswer = { indices: number[] };

type Provider = "ollama" | "gemini";

/** JSON schema both backends use to force structured output. */
const INDICES_SCHEMA = {
  type: "object",
  properties: { indices: { type: "array", items: { type: "integer" } } },
  required: ["indices"],
};

export function resolveProvider(): Provider {
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase();
  if (explicit === "ollama") return "ollama";
  if (explicit === "gemini") return "gemini";
  return geminiConfigured() ? "gemini" : "ollama";
}

export function aiConfigured(): boolean {
  const p = resolveProvider();
  return p === "gemini" ? geminiConfigured() : ollamaConfigured();
}

function buildPrompt(q: McqQuestion): string {
  const opts = q.options.map((o, i) => `${i}. ${o.replace(/\s+/g, " ").trim()}`).join("\n");
  const howMany = q.multiple
    ? "One or more options may be correct."
    : "Exactly one option is correct.";
  return [
    "You are answering a multiple-choice question. Pick the correct option(s).",
    howMany,
    'Respond with ONLY a JSON object of the chosen option numbers, e.g. {"indices":[2]}.',
    "",
    `Question: ${q.question.replace(/\s+/g, " ").trim()}`,
    "Options:",
    opts,
  ].join("\n");
}

/** Pull an {"indices":[...]} object out of whatever the model returned. */
function parseIndices(text: string, optionCount: number): number[] {
  let raw = text.trim();
  const fenced = raw.match(/\{[\s\S]*\}/);
  if (fenced) raw = fenced[0];
  try {
    const obj = JSON.parse(raw);
    const arr = Array.isArray(obj?.indices) ? obj.indices : [];
    const clean = arr
      .map((n: unknown) => Number(n))
      .filter((n: number) => Number.isInteger(n) && n >= 0 && n < optionCount);
    return Array.from(new Set(clean));
  } catch {
    const nums = (raw.match(/\d+/g) || []).map(Number).filter((n) => n >= 0 && n < optionCount);
    return Array.from(new Set(nums));
  }
}

async function complete(prompt: string): Promise<string | null> {
  return resolveProvider() === "gemini"
    ? geminiComplete(prompt, INDICES_SCHEMA)
    : ollamaComplete(prompt, INDICES_SCHEMA);
}

/**
 * Ask the configured model to answer one MCQ. Retries a couple times if the model
 * returns nothing parseable — the single biggest cause of a question being left
 * blank. Returns chosen option indices, or null if every attempt failed.
 */
export async function answerMcq(q: McqQuestion): Promise<McqAnswer | null> {
  if (!q.options.length) return null;
  const prompt = buildPrompt(q);
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await complete(prompt);
    if (text) {
      let indices = parseIndices(text, q.options.length);
      if (!q.multiple && indices.length > 1) indices = [indices[0]];
      if (indices.length) return { indices };
    }
  }
  return null;
}
