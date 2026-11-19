// Run with: npm test (or node --import ./test/register.mjs --test lib/practice/prepare.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { courseSummary, weekCoverage } from "./coverage.ts";
import { decide, MAX_FAILURES_IN_ROW, outcomeOf, STOP_MESSAGES, weeksToPrepare } from "./prepare.ts";
import { DAY_SECONDS, GEN_PER_BURST, GEN_PER_DAY, generationVerdict } from "./limits.ts";
import { BANK_TARGET, batchSizeFor } from "./targets.ts";

/* ------------------------------------------------------------ coverage --- */

test("week coverage in plain words", () => {
  assert.deepEqual(weekCoverage(24), { kind: "ready", label: "Ready: 24 questions" });
  assert.deepEqual(weekCoverage(BANK_TARGET), { kind: "ready", label: `Ready: ${BANK_TARGET} questions` });
  assert.deepEqual(weekCoverage(8), { kind: "started", label: "Started: 8 questions" });
  assert.deepEqual(weekCoverage(1), { kind: "started", label: "Started: 1 question" });
  assert.deepEqual(weekCoverage(0), { kind: "empty", label: "No questions yet. Be the first to add this week." });
  assert.equal(weekCoverage(null).kind, "unknown");
  assert.equal(weekCoverage(undefined).label, "");
});

test("course summary counts ready weeks, and says nothing when counts are unknown", () => {
  assert.equal(courseSummary([20, 25, 3, 0, 20]), "3 of 5 weeks ready");
  assert.equal(courseSummary([0]), "0 of 1 week ready");
  assert.equal(courseSummary([20, null]), "");
  assert.equal(courseSummary([]), "");
});

/* ------------------------------------------------------------- queue --- */

const w = (week: number, count: number | null) => ({ courseCode: "cos202", courseId: 9, week, count });

test("the queue picks weeks below the target, in order, and skips ready and unknown weeks", () => {
  const out = weeksToPrepare([w(1, 20), w(2, 0), w(3, 25), w(4, 12), w(5, null), w(6, 19)]);
  assert.deepEqual(out.map((x) => x.week), [2, 4, 6]);
  assert.deepEqual(weeksToPrepare([w(1, 20), w(2, 30)]), []);
});

test("one call per week asks for enough to reach the target", () => {
  assert.equal(batchSizeFor(0), 20);
  assert.equal(batchSizeFor(8), 20);
  assert.equal(batchSizeFor(12), 10);
  assert.equal(batchSizeFor(19), 10);
  assert.equal(batchSizeFor(20), 0);
  assert.equal(batchSizeFor(25), 0);
});

test("each week gets one call: ready moves on as done, short moves on as started", () => {
  assert.deepEqual(decide({ kind: "added", bankSize: 20 }, 0), { action: "next", done: true });
  assert.deepEqual(decide({ kind: "added", bankSize: 15 }, 0), { action: "next", done: false });
  assert.deepEqual(decide({ kind: "full", bankSize: 22 }, 0), { action: "next", done: true });
});

test("the run stops cleanly on quota, a bad key, our limit or a lost login", () => {
  assert.deepEqual(decide({ kind: "quota" }, 0), { action: "stop", message: STOP_MESSAGES.quota });
  const bad = decide({ kind: "invalid_key" }, 0);
  assert.equal(bad.action, "stop");
  assert.equal((bad as any).fixKey, true);
  assert.equal(decide({ kind: "limited" }, 0).action, "stop");
  assert.equal(decide({ kind: "logged_out" }, 0).action, "stop");
  assert.equal(decide({ kind: "unavailable" }, 0).action, "stop");
});

test("a failed week is skipped, and repeated failures stop the run", () => {
  assert.deepEqual(decide({ kind: "failed" }, 1), { action: "next", done: false });
  assert.equal(decide({ kind: "failed" }, MAX_FAILURES_IN_ROW).action, "stop");
});

test("responses map to outcomes", () => {
  assert.deepEqual(outcomeOf(200, { added: 10, bankSize: 10 }), { kind: "added", bankSize: 10 });
  assert.deepEqual(outcomeOf(409, { full: true, bankSize: 21 }), { kind: "full", bankSize: 21 });
  assert.equal(outcomeOf(429, { keyError: "quota" }).kind, "quota");
  assert.equal(outcomeOf(429, { limited: "day" }).kind, "limited");
  assert.equal(outcomeOf(400, { keyError: "invalid_key" }).kind, "invalid_key");
  assert.equal(outcomeOf(401, null).kind, "logged_out");
  assert.equal(outcomeOf(503, { unavailable: true }).kind, "unavailable");
  assert.equal(outcomeOf(502, { keyError: "failed" }).kind, "failed");
  assert.equal(outcomeOf(0, null).kind, "failed");
});

/* --------------------------------------------------------- rate limit --- */

test("the daily cap lets one student prepare about 8 courses of 14 weeks", () => {
  assert.ok(GEN_PER_DAY >= 8 * 14);
  assert.ok(DAY_SECONDS === 86_400);
  assert.deepEqual(generationVerdict({ burst: 0, day: 0 }), { ok: true });
  assert.deepEqual(generationVerdict({ burst: 10, day: GEN_PER_DAY - 1 }), { ok: true });
  assert.deepEqual(generationVerdict({ burst: 0, day: GEN_PER_DAY }), { ok: false, reason: "day" });
});

test("a burst well above the paced queue is refused", () => {
  assert.deepEqual(generationVerdict({ burst: GEN_PER_BURST, day: GEN_PER_BURST }), { ok: false, reason: "burst" });
  // The paced queue (one call plus a 6 s pause) makes at most ~40 calls in ten minutes only if
  // every call returned instantly; real calls take 15 to 40 s, so ~15 to 25.
  assert.ok(GEN_PER_BURST >= 25);
});
