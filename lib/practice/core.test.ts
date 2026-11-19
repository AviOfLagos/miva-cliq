// Run with: npm test (or node --import ./test/register.mjs --test lib/practice/core.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANK_TARGET,
  BATCH_SIZE,
  CONFIRM_AFTER_ANSWERS,
  HIDE_AFTER_REPORTS,
  cleanApiKey,
  cleanCourseCode,
  cleanQuestionId,
  cleanWeek,
  dueAt,
  hashQuestion,
  historiesFrom,
  isCorrectChoice,
  nextStatus,
  parseBatchText,
  pickSet,
  shuffle,
  toServed,
  validateBatch,
  validateQuestion,
  type StoredQuestion,
} from "./core.ts";

const DAY = 24 * 60 * 60 * 1000;

const good = {
  question: "Which data structure works on a last-in, first-out basis?",
  options: ["Queue", "Stack", "Linked list", "Hash table"],
  answer_index: 1,
  explanation: "A stack removes the most recently added item first.",
};

/** Deterministic RNG so shuffles are repeatable. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/* ---------------------------------------------------------- validation --- */

test("a well-formed question passes and is cleaned", () => {
  const q = validateQuestion({ ...good, question: "  Which data structure works   on a\nlast-in, first-out basis? " });
  assert.ok(q);
  assert.equal(q.question, "Which data structure works on a last-in, first-out basis?");
  assert.equal(q.answerIndex, 1);
  assert.equal(q.hash, hashQuestion(good.question));
});

test("option letters the model adds are stripped", () => {
  const q = validateQuestion({ ...good, options: ["A) Queue", "B. Stack", "(c) Linked list", "d: Hash table"] });
  assert.deepEqual(q?.options, ["Queue", "Stack", "Linked list", "Hash table"]);
});

test("rejects wrong option counts, blanks and duplicates", () => {
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", "Tree"] }), null);
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", "Tree", "Heap", "Graph"] }), null);
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", " ", "Heap"] }), null);
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", "stack.", "Heap"] }), null);
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", 3, "Heap"] }), null);
});

test("rejects out-of-range or non-integer answer indexes", () => {
  for (const answer_index of [-1, 4, 1.5, "1", null, undefined]) {
    assert.equal(validateQuestion({ ...good, answer_index }), null, String(answer_index));
  }
  for (const answer_index of [0, 1, 2, 3]) assert.ok(validateQuestion({ ...good, answer_index }));
});

test("caps lengths and needs an explanation", () => {
  assert.equal(validateQuestion({ ...good, question: "Short?" }), null);
  assert.equal(validateQuestion({ ...good, question: "x".repeat(301) }), null);
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", "y".repeat(141), "Heap"] }), null);
  assert.equal(validateQuestion({ ...good, explanation: "" }), null);
  assert.equal(validateQuestion({ ...good, explanation: "z".repeat(281) }), null);
});

test("rejects options that only make sense in a fixed order", () => {
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", "Heap", "All of the above"] }), null);
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", "Heap", "None of the above"] }), null);
  assert.equal(validateQuestion({ ...good, options: ["Queue", "Stack", "Heap", "Both A and B"] }), null);
});

test("batch drops bad items, in-batch repeats and questions already in the bank", () => {
  const already = { ...good, question: "What does CPU stand for in computing?" };
  const batch = {
    questions: [
      good,
      { ...good, question: "which data structure works on a LAST in first out basis" }, // same after normalising
      { ...good, options: ["a", "b"] },
      already,
      { ...good, question: "Which structure is first-in, first-out?", answer_index: 0 },
    ],
  };
  const out = validateBatch(batch, [hashQuestion(already.question)]);
  assert.deepEqual(
    out.map((q) => q.question),
    [good.question, "Which structure is first-in, first-out?"],
  );
});

test("batch tolerates junk and a bare array, and caps how much it reads", () => {
  assert.deepEqual(validateBatch(null), []);
  assert.deepEqual(validateBatch("nope"), []);
  assert.equal(validateBatch([good]).length, 1);
  const many = Array.from({ length: 50 }, (_, i) => ({ ...good, question: `Question number ${i} about stacks?` }));
  assert.ok(validateBatch({ questions: many }).length <= BANK_TARGET * 2);
  assert.equal(validateBatch({ questions: many }, [], 10).length, 10);
});

test("parseBatchText reads plain and fenced JSON", () => {
  assert.deepEqual(parseBatchText('{"questions":[]}'), { questions: [] });
  assert.deepEqual(parseBatchText('```json\n{"questions":[1]}\n```'), { questions: [1] });
  assert.equal(parseBatchText("not json"), null);
  assert.equal(parseBatchText(""), null);
});

/* --------------------------------------------------- spaced repetition --- */

test("history folds attempts in time order whatever the input order", () => {
  const h = historiesFrom([
    { questionId: "1", correct: true, answeredAt: 3 * DAY },
    { questionId: "1", correct: false, answeredAt: 1 * DAY },
    { questionId: "1", correct: true, answeredAt: 2 * DAY },
    { questionId: "2", correct: true, answeredAt: DAY },
  ]);
  assert.deepEqual(h.get("1"), { lastAt: 3 * DAY, missAt: DAY, correctSinceMiss: 2 });
  assert.deepEqual(h.get("2"), { lastAt: DAY, missAt: null, correctSinceMiss: 0 });
});

test("a miss comes back 1, 3 and 7 days after it, then graduates", () => {
  const miss = 100 * DAY;
  assert.equal(dueAt({ lastAt: miss, missAt: miss, correctSinceMiss: 0 }), miss + 1 * DAY);
  assert.equal(dueAt({ lastAt: miss + DAY, missAt: miss, correctSinceMiss: 1 }), miss + 3 * DAY);
  assert.equal(dueAt({ lastAt: miss + 3 * DAY, missAt: miss, correctSinceMiss: 2 }), miss + 7 * DAY);
  assert.equal(dueAt({ lastAt: miss + 7 * DAY, missAt: miss, correctSinceMiss: 3 }), null);
  // Never missed: not in review.
  assert.equal(dueAt({ lastAt: miss, missAt: null, correctSinceMiss: 0 }), null);
  // Came back late: not due again the same day.
  assert.equal(dueAt({ lastAt: miss + 10 * DAY, missAt: miss, correctSinceMiss: 1 }), miss + 11 * DAY);
});

const bankQ = (id: string, status: StoredQuestion["status"] = "unconfirmed") => ({ id, status });

test("set order: due misses first, then unseen, then the rest; hidden never", () => {
  const now = 50 * DAY;
  const questions = [
    bankQ("seen-old"),
    bankQ("unseen-a"),
    bankQ("due-recent"),
    bankQ("hidden", "hidden"),
    bankQ("due-overdue"),
    bankQ("miss-not-yet-due"),
    bankQ("unseen-b", "confirmed"),
    bankQ("seen-new"),
  ];
  const histories = historiesFrom([
    { questionId: "seen-old", correct: true, answeredAt: now - 20 * DAY },
    { questionId: "seen-new", correct: true, answeredAt: now - 2 * DAY },
    { questionId: "due-recent", correct: false, answeredAt: now - 1 * DAY },
    { questionId: "due-overdue", correct: false, answeredAt: now - 5 * DAY },
    { questionId: "miss-not-yet-due", correct: false, answeredAt: now - 1000 },
    { questionId: "hidden", correct: false, answeredAt: now - 9 * DAY },
  ]);
  const ids = pickSet(questions, histories, now, 10, seeded(1)).map((q) => q.id);
  assert.deepEqual(ids.slice(0, 2), ["due-overdue", "due-recent"]);
  assert.deepEqual([...ids.slice(2, 4)].sort(), ["unseen-a", "unseen-b"]);
  assert.deepEqual(ids.slice(4), ["seen-old", "seen-new", "miss-not-yet-due"]);
  assert.ok(!ids.includes("hidden"));
});

test("a set is capped at five", () => {
  const questions = Array.from({ length: 12 }, (_, i) => bankQ(String(i)));
  assert.equal(pickSet(questions, new Map(), Date.now()).length, 5);
});

/* ------------------------------------------------------------- serving --- */

const stored: StoredQuestion = {
  id: "7",
  question: good.question,
  options: good.options,
  answerIndex: 1,
  explanation: good.explanation,
  status: "unconfirmed",
};

test("shuffling keeps the right answer right", () => {
  for (let seed = 0; seed < 200; seed++) {
    const served = toServed(stored, seeded(seed));
    assert.deepEqual([...served.options].sort(), [...stored.options].sort());
    const right = served.options.filter((o) => isCorrectChoice(stored, o));
    assert.deepEqual(right, ["Stack"]);
  }
  assert.equal(isCorrectChoice(stored, " Stack "), true);
  assert.equal(isCorrectChoice(stored, "Queue"), false);
  assert.equal(isCorrectChoice(stored, 1), false);
  assert.equal(isCorrectChoice(stored, undefined), false);
});

test("shuffle actually reorders and never mutates its input", () => {
  const input = ["a", "b", "c", "d"];
  const orders = new Set<string>();
  for (let seed = 0; seed < 50; seed++) orders.add(shuffle(input, seeded(seed)).join(""));
  assert.ok(orders.size > 5);
  assert.deepEqual(input, ["a", "b", "c", "d"]);
});

test("a served payload contains no answer", () => {
  const leaky = { ...stored, author_hash: "secret", answer_index: 1, served_count: 3 } as any;
  const served = toServed(leaky, seeded(3));
  assert.deepEqual(Object.keys(served).sort(), ["id", "options", "question", "status"]);
  const json = JSON.stringify(served);
  assert.ok(!/answer|explanation|author|served_count/i.test(json));
  assert.ok(!json.includes(stored.explanation));
  // A hidden question is never presented as anything but unconfirmed/confirmed.
  assert.equal(toServed({ ...stored, status: "hidden" }).status, "unconfirmed");
});

/* ------------------------------------------------------------- quality --- */

test("confirmed after five distinct answerers with no reports", () => {
  assert.equal(nextStatus({ status: "unconfirmed", answerers: CONFIRM_AFTER_ANSWERS - 1, reports: 0 }), "unconfirmed");
  assert.equal(nextStatus({ status: "unconfirmed", answerers: CONFIRM_AFTER_ANSWERS, reports: 0 }), "confirmed");
  assert.equal(nextStatus({ status: "unconfirmed", answerers: 40, reports: 1 }), "unconfirmed");
  assert.equal(nextStatus({ status: "confirmed", answerers: 40, reports: 2 }), "confirmed");
});

test("hidden after three distinct reports, and hidden is final", () => {
  assert.equal(nextStatus({ status: "confirmed", answerers: 40, reports: HIDE_AFTER_REPORTS }), "hidden");
  assert.equal(nextStatus({ status: "unconfirmed", answerers: 0, reports: HIDE_AFTER_REPORTS }), "hidden");
  assert.equal(nextStatus({ status: "hidden", answerers: 99, reports: 0 }), "hidden");
});

/* -------------------------------------------------------- input checks --- */

test("input cleaners accept only the expected shapes", () => {
  assert.equal(cleanCourseCode("cos202"), "cos202");
  assert.equal(cleanCourseCode("COS 202"), null);
  assert.equal(cleanCourseCode("cos202; drop"), null);
  assert.equal(cleanWeek(3), 3);
  assert.equal(cleanWeek("3"), 3);
  assert.equal(cleanWeek(0), null);
  assert.equal(cleanWeek(2.5), null);
  assert.equal(cleanQuestionId("42"), "42");
  assert.equal(cleanQuestionId(42), "42");
  assert.equal(cleanQuestionId("4x"), null);
  assert.equal(cleanApiKey("  AIzaSyA1234567890abcdefghijklmnopqrstu "), "AIzaSyA1234567890abcdefghijklmnopqrstu");
  assert.equal(cleanApiKey("short"), null);
  assert.equal(cleanApiKey("AIza key with spaces 1234567890123456789"), null);
});
