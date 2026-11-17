import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runCourse, type ProgressEvent, type CourseSummary } from "@/lib/completion/engine";
import { ajaxBatch, NOT_PROCESSED } from "@/lib/moodle/client";
import { nextPass, type ResumeState, MAX_PASSES } from "@/lib/run/resume";
import { tallyOutcome, recordOutcomes } from "@/lib/store/completionStats";
import { installFakeMoodle, pages, session, LMS, type FakeMoodle, type FakeCm } from "./fakeMoodle";

let fake: FakeMoodle | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

async function pass(
  opts: Parameters<typeof runCourse>[3] = {},
): Promise<{ events: ProgressEvent[]; summary: CourseSummary }> {
  const events: ProgressEvent[] = [];
  const summary = await runCourse(session, 99, (e) => events.push(e), opts);
  return { events, summary };
}

const byCmid = (events: ProgressEvent[]) => new Map(events.map((e) => [e.cmid, e]));

test("batch marking: 60 manual pages in 1 state read + 3 mark requests, trusted without re-reading", async () => {
  fake = installFakeMoodle(pages(60));
  const { events, summary } = await pass();

  assert.equal(summary.done, 60);
  assert.equal(summary.remaining, 0);
  assert.ok(events.every((e) => e.status === "done" && e.reason === "marked"));
  assert.equal(fake.count("state"), 1, "course state read once");
  assert.equal(fake.count("mark"), 3, "25 + 25 + 10");
  assert.equal(fake.count("view"), 0);
  assert.deepEqual(
    fake.requests.filter((r) => r.kind === "mark").map((r) => r.methods!.length),
    [25, 25, 10],
  );
  // The state read batches get_state with the completion-rules call.
  assert.deepEqual(fake.requests[0].methods, [
    "core_courseformat_get_state",
    "core_completion_get_activities_completion_status",
  ]);
});

test("batch marking resubmits calls Moodle skipped after an error in the batch", async () => {
  // No completion-status call, so the engine cannot know #5 is automatic: it
  // marks it, Moodle refuses it and drops the rest of that batch.
  const cms: FakeCm[] = pages(10);
  cms[4] = { id: 5, name: "Video", module: "url", state: 0, tracking: "auto", rules: ["completionview"] };
  fake = installFakeMoodle(cms, { noStatusCall: true });
  const { events, summary } = await pass();
  const ev = byCmid(events);

  assert.equal(summary.done, 10);
  for (const id of [1, 2, 3, 4, 6, 7, 8, 9, 10]) assert.equal(ev.get(id)?.reason, "marked");
  assert.equal(ev.get(5)?.reason, "viewed", "the automatic one completes in the view pass");
  assert.equal(fake.count("mark"), 2, "one batch cut short at #5, one resubmitting #6-#10");
  assert.deepEqual(fake.markCalls.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("view pass: automatic activities are viewed (no redirect follow), confirmed by one state read", async () => {
  fake = installFakeMoodle([
    { id: 1, name: "Reading", module: "url", state: 0, tracking: "auto", rules: ["completionview"] },
    { id: 2, name: "Slides", module: "resource", state: 0, tracking: "auto", rules: ["completionview"] },
    { id: 3, name: "H5P check", module: "h5pactivity", state: 0, tracking: "auto", rules: ["completionusegrade"] },
    { id: 4, name: "Outside link", module: "url", state: 0, tracking: "auto", rules: ["completionview"], url: "https://example.org/slow" },
    { id: 5, name: "Page", module: "page", state: 0, tracking: "manual" },
  ]);
  const { events, summary } = await pass();
  const ev = byCmid(events);

  assert.equal(fake.count("mark"), 1, "only the manual one is marked");
  assert.deepEqual(fake.markCalls, [5]);
  assert.ok(fake.requests.filter((r) => r.kind === "view").every((r) => r.redirect === "manual"));
  assert.equal(fake.count("external"), 0, "never sends the session to a non-LMS URL");
  assert.equal(fake.count("state"), 2, "initial read + one read after the view pass");

  assert.equal(ev.get(1)?.reason, "viewed");
  assert.equal(ev.get(2)?.reason, "viewed");
  assert.equal(ev.get(5)?.reason, "marked");
  assert.equal(ev.get(3)?.status, "failed");
  assert.equal(ev.get(3)?.reason, "needs-score");
  assert.equal(ev.get(4)?.status, "failed", "an external URL is not viewed, so not claimed done");
  assert.equal(summary.done, 3);
});

test("policy: graded quizzes, assignments and exam-named items get no request at all", async () => {
  fake = installFakeMoodle([
    { id: 1, name: "Week 1 quiz", module: "quiz", state: 0, tracking: "auto" },
    { id: 2, name: "Assignment 1", module: "assign", state: 0, tracking: "auto" },
    { id: 3, name: "Mid-semester exam briefing", module: "page", state: 0, tracking: "manual" },
    { id: 4, name: "Untracked link", module: "url", state: null },
    { id: 5, name: "Done already", module: "page", state: 1 },
  ]);
  const { events, summary } = await pass();
  const ev = byCmid(events);

  assert.deepEqual(fake.markCalls, []);
  assert.equal(fake.count("view"), 0);
  assert.equal(ev.get(1)?.reason, "quiz-off");
  assert.equal(ev.get(2)?.reason, "graded");
  assert.equal(ev.get(3)?.reason, "graded");
  assert.equal(ev.get(4)?.reason, "no-tracking");
  assert.equal(ev.get(5)?.status, "already");
  assert.equal(summary.done, 0);
  assert.equal(summary.remaining, 0);
});

test("odd mark responses count as 'not marked' and the state re-read decides", async () => {
  fake = installFakeMoodle(pages(3), { junkMarkResponses: true });
  const { events, summary } = await pass();
  // The fake did apply the marks; only the response was junk. Done comes from state.
  assert.equal(summary.done, 3);
  assert.equal(fake.count("state"), 2);
  assert.equal(fake.count("mark"), 1, "a junk response is not resubmitted call by call");
  assert.ok(events.every((e) => e.status === "done"));
});

test("never claims done when neither the mark nor the state confirms it", async () => {
  fake = installFakeMoodle(
    [{ id: 1, name: "Stubborn", module: "lesson", state: 0, tracking: "auto", rules: ["completionendreached"] }],
    { noStatusCall: true },
  );
  const { events, summary } = await pass();
  assert.equal(summary.done, 0);
  assert.equal(events[0].status, "failed");
  assert.equal(events[0].reason, "mark-rejected");
});

test("time budget: stops taking new work and returns what remains, with no events for it", async () => {
  let clock = 0;
  // 10 s per request: state read (t=10), mark batches at t=10, 20, 30, 40 -> budget hit.
  fake = installFakeMoodle(pages(200), { onRequest: () => (clock += 10_000) });
  const { events, summary } = await pass({ now: () => clock, budgetMs: 45_000 });

  assert.equal(fake.count("mark"), 4);
  assert.equal(summary.done, 100);
  assert.equal(events.length, 100, "unreached activities get no event");
  assert.equal(summary.remaining, 100);
});

test("resume: passes with `settled` finish a course too big for one request", async () => {
  let clock = 0;
  fake = installFakeMoodle(pages(260), { onRequest: () => (clock += 10_000) });
  const settled: number[] = [];
  let state: ResumeState = { pass: 0, silentEnds: 0 };
  const statesPerPass: number[] = [];

  for (;;) {
    state = { ...state, pass: state.pass + 1 };
    const before = fake.count("state");
    clock = 0;
    const { events, summary } = await pass({ now: () => clock, budgetMs: 45_000, settled });
    statesPerPass.push(fake.count("state") - before);
    const fresh = events.filter((e) => !e.retry && !settled.includes(e.cmid));
    settled.push(...fresh.map((e) => e.cmid));
    const step = nextPass(state, {
      gotDone: true,
      errored: false,
      remaining: summary.remaining,
      newlySettled: fresh.length,
    });
    state = step.state;
    if (!step.resume) {
      assert.equal(step.why, "finished");
      break;
    }
  }

  assert.equal(state.pass, 3, "100 + 100 + 60");
  assert.equal(settled.length, 260);
  assert.ok(Array.from(fake.cms.values()).every((c) => c.state === 1));
  // Settled activities cost nothing on later passes: each mark goes out once.
  assert.equal(fake.markCalls.length, 260);
});

test("locked activity: reported for retry, then completed on the next pass", async () => {
  fake = installFakeMoodle([
    { id: 1, name: "Intro", module: "page", state: 0, tracking: "manual" },
    { id: 2, name: "Unit 2", module: "page", state: 0, tracking: "manual", lockedUntil: 1 },
  ]);
  const first = await pass();
  const ev1 = byCmid(first.events);
  assert.equal(ev1.get(1)?.status, "done");
  assert.equal(ev1.get(2)?.status, "failed");
  assert.equal(ev1.get(2)?.reason, "locked");
  assert.equal(ev1.get(2)?.retry, true);
  assert.deepEqual(fake.markCalls, [1], "a locked item is not marked");
  assert.equal(first.summary.locked, 1);
  assert.equal(first.summary.remaining, 1);

  const step = nextPass({ pass: 1, silentEnds: 0 }, {
    gotDone: true,
    errored: false,
    remaining: first.summary.remaining,
    newlySettled: 1,
  });
  assert.equal(step.resume, true);

  const second = await pass({ settled: [1] });
  assert.equal(second.events.length, 1, "the settled activity is not re-reported");
  assert.equal(second.events[0].cmid, 2);
  assert.equal(second.events[0].status, "done");
  assert.equal(second.summary.remaining, 0);
});

test("resume policy: stops without progress, retries a cut-off stream, caps passes", () => {
  const s = (pass: number, silentEnds = 0): ResumeState => ({ pass, silentEnds });
  const r = (o: Partial<Parameters<typeof nextPass>[1]>) => ({
    gotDone: true, errored: false, remaining: 0, newlySettled: 0, ...o,
  });
  assert.equal(nextPass(s(1), r({ remaining: 0, newlySettled: 5 })).why, "finished");
  assert.equal(nextPass(s(1), r({ remaining: 3, newlySettled: 5 })).resume, true);
  assert.equal(nextPass(s(2), r({ remaining: 3, newlySettled: 0 })).why, "no-progress");
  // Stream ended with no `done` (function killed): retry, even with no events once.
  const cut = nextPass(s(1), r({ gotDone: false, newlySettled: 0 }));
  assert.equal(cut.resume, true);
  assert.equal(nextPass({ ...cut.state, pass: 2 }, r({ gotDone: false })).why, "no-response");
  assert.equal(nextPass(s(1), r({ errored: true, gotDone: false })).resume, false);
  assert.equal(nextPass(s(MAX_PASSES), r({ remaining: 3, newlySettled: 1 })).why, "pass-cap");
});

test("ajaxBatch: one result per call, whatever shape Moodle returns", async () => {
  const original = globalThis.fetch;
  const calls = [1, 2, 3].map((cmid) => ({ methodname: "m", args: { cmid } }));
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: true, exception: { message: "Invalid sesskey", errorcode: "invalidsesskey" } }))) as typeof fetch;
    const whole = await ajaxBatch(session, calls);
    assert.equal(whole.length, 3);
    assert.ok(whole.every((r) => r.error && r.exception?.errorcode === "invalidsesskey"));

    globalThis.fetch = (async () => new Response("<html>login</html>", { status: 303 })) as typeof fetch;
    const html = await ajaxBatch(session, calls);
    assert.ok(html.every((r) => r.error && r.exception?.errorcode === NOT_PROCESSED));

    globalThis.fetch = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    const down = await ajaxBatch(session, calls);
    assert.ok(down.every((r) => r.error && r.exception?.errorcode === NOT_PROCESSED));
  } finally {
    globalThis.fetch = original;
  }
});

test("telemetry: tally keys are sanitised; recording is a no-op without a database", async () => {
  const tally = new Map<string, number>();
  tallyOutcome(tally, { modname: "page", status: "done", reason: "marked" });
  tallyOutcome(tally, { modname: "page", status: "done", reason: "marked" });
  tallyOutcome(tally, { modname: "H5P Activity!", status: "failed", reason: "needs score" });
  assert.equal(tally.get("page|done|marked"), 2);
  assert.equal(tally.get("h5pactivity|failed|needsscore"), 1);
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await recordOutcomes(tally); // must not throw
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
  assert.ok(LMS);
});
