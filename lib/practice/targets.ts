/**
 * Bank sizes, in a module with no imports at all so browser code (the Study
 * page's coverage and prepare queue) can share them with the server. core.ts
 * re-exports both.
 */

/** A course-week with fewer usable questions than this asks for more. */
export const BANK_TARGET = 20;
/** Questions asked of the model per generation call. */
export const BATCH_SIZE = 10;
