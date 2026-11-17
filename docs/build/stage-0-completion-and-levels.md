# Stage 0 and 1 build brief: completion rate, level detection

Written 2026-11-17 for whoever builds this. Product context is in
[../product/web-app-plan.md](../product/web-app-plan.md).

## Status of the diagnosis

Read from the code, **not yet confirmed against the live LMS**. Nobody was
logged in to lms.miva.university when this was written, and there is no
stored telemetry: the database keeps only a user count and a run count. So
causes 1 and 2 below are certain defects, and cause 3 is an open question
until someone looks at a logged-in course.

## Why completion dropped to about 10 percent

### Cause 1: a run is cut off at 60 seconds and nothing resumes it

`/api/run` handles one course per request with `maxDuration = 60`.
`runCourse` in `lib/completion/engine.ts` walks activities one at a time.
For each one:

- `mark()` is one request.
- `verify()` calls `completionStateOf`, which re-downloads the **whole
  course state** to read one activity (`lib/moodle/activities.ts`).
- A view-completion activity costs up to five requests: mark, verify, GET
  the page, verify, verify again (`strategies/manualMarkDone.ts`).

That is 2 to 5 round trips per activity, each carrying the full course. A
course with 100 unfinished activities needs 200 to 500 requests. At a few
hundred milliseconds each, that does not fit in 60 seconds.

When Vercel kills the function the stream just ends. In
`lib/run/AppContext.tsx` `runAll` reads the stream, sees no `done` event and
moves on to the next course. No retry, no message. Whatever finished in the
first minute is the result.

Why it looked fine before: accounts that were tested had most activities
already complete, and "already" costs no requests. On a fresh semester every
activity is unfinished, so the same code now covers a fraction of each
course. A share of 10 to 20 percent per course is what this predicts.

### Cause 2: the only preset is last semester's courses

`lib/presets.ts` holds one preset: Computer Engineering, second semester,
seven 200-level courses. The choose screen uses `presets[0]`
(`app/cliq/page.tsx:317`). A student who has moved up a level, or is in any
other department, gets courses they are not taking; `resolveCourses` drops
the ones that do not match.

### Cause 3 (unconfirmed): the LMS may have changed

Things to check once logged in, in this order:

1. Does `core_courseformat_get_state` still return `completionstate` on
   each `cm`, and is `module` still the short type name?
2. For a new-semester course, what share of activities are manual
   completion against view, grade or pass-required?
3. Are activities locked behind earlier ones (`uservisible: false`,
   availability restrictions)?
4. Are there new activity types (H5P, SCORM, lesson, interactive video)
   that complete only on a score?
5. Does the SIS login response or a profile endpoint on
   `sis-be.miva.university` return programme and level?

The telemetry in the fix below answers 2 to 4 from real runs without anyone
needing to probe by hand.

## Fix: completion engine

Goal: the same honest reporting, in a small fixed number of requests per
course, and a run that always finishes.

1. **Batch the manual marks.** Moodle's `/lib/ajax/service.php` accepts an
   array of calls in one POST. Add `ajaxBatch` to `lib/moodle/client.ts` and
   mark in chunks of about 25. One request replaces 25.
2. **Trust Moodle's answer.** The mark call returns `status: true`. The
   README already says that is the verification. Stop re-reading the course
   after each one.
3. **Verify in bulk.** After the marks, read course state once. Anything
   now complete is done.
4. **View pass for the rest.** GET each remaining activity URL with
   `redirect: "manual"` and a timeout of a few seconds. Today the fetch
   follows redirects to external sites with no timeout, so one slow link can
   eat the whole minute. Then read course state once more.
5. **Then the slow strategies.** Forum replies and quiz answering keep
   their per-activity path, run last.
6. **A time budget and resume.** Stop taking new work at about 45 seconds.
   Return how many activities remain. The client calls `/api/run` again for
   the same course while there is work left and the last pass made progress.
   It also retries when a stream ends without `done`. Cap the passes.
7. **Say why.** Every failure carries the activity type and a reason:
   locked, needs a score, needs a forum reply, unknown type. Locked items
   are retried on the next pass, since finishing earlier items may unlock
   them.
8. **Count outcomes.** One table of daily counters by activity type and
   outcome, no user identity. This is how we find out what the LMS changed
   next time.

Keep the strategy registry as the extension point. Policy does not change:
graded quizzes, assignments and anything named like an exam are never
touched.

Done when: `npx tsc --noEmit` and `next build` pass, and the engine's logic
is covered by a test that runs against a fake Moodle (a stubbed `fetch`),
including the resume path.

## Fix: level detection and automatic course selection

### Detect

- Level from course codes: the hundreds digit of the code (`COS 202` is
  200 level). Take the highest level that at least two current courses
  share, so one carry-over course does not decide it.
- Semester from the last digit of the code: odd is first, even is second.
  Take the majority.
- Current courses: ask Moodle for the `inprogress` classification first and
  fall back to `all`.
- Department: use what the SIS returns if it returns it. Otherwise guess
  from the most common code prefix (`COS`, `ACC`, `NSC`), and ask once to
  confirm, using the list in `lib/taxonomy.ts`. Remember the answer.

### Assign

- The default choice on the Autopilot screen becomes "Your courses this
  semester": the student's in-progress courses at the detected level,
  already selected. Custom selection stays.
- Remove the dependency on the hard-coded preset. Keep it only as a
  fallback when detection finds nothing.

### The recommended package builds itself

A `curriculum` table records, per department, level and semester, which
course codes students at that level are enrolled in, with a count of
distinct students (by the existing salted hash, never an identity). The
recommended list for a department and level is the courses a clear majority
share. No hand-typed course lists to keep current, and it covers every
department as soon as a few students from it log in.

Show a course from the package that the student is **not** enrolled in as a
note ("most 300-level Computer Science students also take COS 305"), never
as something we can run: we can only act on courses they are enrolled in.

Done when: the detection functions have tests for mixed levels, a
carry-over course and an empty list, and the Autopilot screen shows the
detected level and pre-selected courses.

## Constraints for both pieces of work

- `main` requires a pull request. Open one per piece of work.
- No new dependencies unless there is no reasonable alternative.
- New tables go in `db/schema.sql`, idempotent, and the code must keep
  working when the database is not configured.
- Never store a password, an email, or raw Moodle cookies.
