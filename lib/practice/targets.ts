/**
 * Bank sizes, in a module with no imports at all so browser code (the Study
 * page's coverage and prepare queue) can share them with the server. core.ts
 * re-exports them.
 */

/** A course-week with fewer usable questions than this asks for more. */
export const BANK_TARGET = 20;
/** Batches are asked for in multiples of this. */
export const BATCH_SIZE = 10;

/**
 * How many questions to ask for in one call so the week reaches the target in
 * that call: the whole target for an empty week, otherwise the shortfall
 * rounded up to a whole batch. One call per week keeps a free Gemini key
 * inside its daily quota for a whole semester. 0 when the week is full.
 */
export function batchSizeFor(bankSize: number, target: number = BANK_TARGET): number {
  const have = Math.max(0, Math.floor(bankSize) || 0);
  if (have >= target) return 0;
  if (have === 0) return target;
  return Math.ceil((target - have) / BATCH_SIZE) * BATCH_SIZE;
}
