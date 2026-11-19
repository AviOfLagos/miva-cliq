// Run with: npm test (or node --import ./test/register.mjs --test lib/practice/salvage.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBatchText, validateBatch } from "./core.ts";

const q = (i: number) => ({
  question: `What does example number ${i} show about loops?`,
  options: [`Answer ${i} a`, `Answer ${i} b`, `Answer ${i} c`, `Answer ${i} d`],
  answer_index: 1,
  explanation: `Because of reason ${i}, with a "quote" and a brace } inside.`,
});

test("a truncated batch keeps its complete questions and the notes", () => {
  const full = JSON.stringify({ notes: "- Loops repeat code.\n- For loops count.", questions: [q(1), q(2), q(3)] });
  const cut = full.slice(0, full.lastIndexOf("answer_index") - 2); // mid third question
  const parsed = parseBatchText(cut) as any;
  assert.equal(parsed.notes, "- Loops repeat code.\n- For loops count.");
  assert.equal(parsed.questions.length, 2);
  assert.equal(validateBatch(parsed).length, 2);
});

test("whole JSON still parses normally, and garbage is still null", () => {
  const parsed = parseBatchText(JSON.stringify({ questions: [q(1)] })) as any;
  assert.equal(parsed.questions.length, 1);
  assert.equal(parseBatchText("no json here"), null);
});

test("a batch of 20 is not cut short by validation", () => {
  const list = Array.from({ length: 20 }, (_, i) => q(i));
  assert.equal(validateBatch({ questions: list }).length, 20);
});
