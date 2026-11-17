# Miva Cliq

Browserless auto-completion for the Miva Open University (Moodle) LMS, plus a
small anonymous community (Gists). No browser, no fixed sleeps, runs on a free
serverless tier, and verifies every completion instead of assuming it.

## Why it's fast

Miva's LMS is Moodle 5.0. "Mark as done" is a Moodle AJAX call, and login —
though fronted by a CAS SSO portal — reduces to three HTTP requests. So the whole
flow is plain `fetch`: log in, list activities, fire completion calls, confirm
state. A full account completes in seconds-to-minutes vs. the old bot's hours.
See `../PROBE-FINDINGS.md` for the reverse-engineering details.

## Architecture

```
lib/moodle/       browserless Moodle client
  auth.ts         CAS login -> MoodleSession {cookies, sesskey, userId}
  client.ts       /lib/ajax/service.php helper: ajax() and ajaxBatch() (many calls, one POST)
  courses.ts      list enrolled + resolve preset names -> ids
  activities.ts   course state + completion rules in one batched read
  view.ts         GET an activity page (LMS only, no redirects, 5s timeout)
  forum.ts        reply to a discussion (mod_forum_add_discussion_post)
lib/completion/   pluggable completion engine
  registry.ts     ORDERED strategy list (first match wins)
  strategies/     aiQuizAnswer, gradedSkip, noCompletion, forumReply, manualMarkDone, unknownFallback
  engine.ts       plan() preview + runCourse(): one time-boxed pass over a course
lib/run/          client run state (survives navigation)
  AppContext.tsx  the run loop + screen/auth state, mounted in the layout
  resume.ts       when to call /api/run again for the same course
  history.ts      per-device run history (localStorage, by email)
  prefs.ts        per-device forum reply messages
  sse.ts / types.ts
lib/store/        server storage for Gists + aggregate metrics (needs a DB;
                  degrades to "off" with no env configured)
  completionStats.ts  daily outcome counters by activity type (no identity)
lib/presets.ts    curated course presets (Computer Engineering · Second Semester)
lib/session.ts    AES-GCM sealed session cookie
app/api/          login, courses, presets, plan, run (SSE), logout, gists, metrics
app/page.tsx      UI: login -> choose (preset|custom) -> live progress
app/gists/        anonymous community board
test/             node:test suite against a fake Moodle (stubbed fetch): `npm test`
app/how-it-works/, app/terms/, app/privacy/, app/disclaimer/   info + legal
```

## How a run works

A run is one SSE request to `/api/run` per course **pass**. A pass costs a
small, fixed number of requests rather than several per activity:

1. One read of course state: `core_courseformat_get_state` batched with
   `core_completion_get_activities_completion_status` (manual vs automatic
   tracking, and which completion rules are unmet).
2. Instant decisions, no requests: already complete, policy skips, locked items.
3. Manual marks in batches of 25 per POST. Moodle's `status: true` is the
   verification. Moodle stops a batch at the first refused call, so the calls
   it never reached are resubmitted.
4. One state read, then a view pass for what is left (concurrent GETs, LMS URLs
   only, no redirects followed, 5s timeout), then one more state read.
5. Per-activity strategies last: forum replies, quiz answering.

For a fresh 100-activity course of manual pages that is about 5 requests
(1 read + 4 mark batches); view-completion items add one light GET each plus
one state read. The old engine needed 200-500, each verify re-downloading the
whole course.

The engine stops taking new work at 45s (the function cap is 60s) and returns
`remaining`. The client calls `/api/run` again for the same course, passing the
activities already settled so they cost nothing, while there is work left and
the last pass made progress; a stream that ends without `done` is retried too.
At most 6 passes per course. Locked activities are reported with `retry` and
tried again next pass, since finishing earlier items may unlock them.

Every progress event carries a `reason` key (`marked`, `viewed`, `locked`,
`needs-score`, `needs-reply`, `unknown-type`, ...). Each pass adds them to
`completion_outcomes`: daily counters by activity type, outcome and reason, with
no user identity. That table is how we notice when the LMS changes.

## Adding a completion method

The LMS will change, or a new activity type will appear. To handle it:

1. Add `lib/completion/strategies/yourStrategy.ts` implementing the `Strategy`
   interface (`detect` / `run`, `action` badge).
2. Register it in `lib/completion/registry.ts` at the right priority.

No engine changes. A strategy declares how expensive it is:

- `bulk: ["mark", "view"]` — the engine does those steps for every activity the
  strategy owns at once; `run()` only sees what is still incomplete afterwards.
- `slow` — `run()` makes its own requests per activity (forum posts, quiz
  attempts), so it runs last, under the time budget.
- neither — `run()` must decide without requests (skips, explanations).

`run()` gets a `StrategyContext` with `mark` / `view` / `verify` /
`whyIncomplete` / `replyToForum` helpers, the user's `forumTexts` and the quiz
toggle, and returns an outcome with a `reason` key.

## Completion policy

- Content (pages, videos, readings, urls): manual "mark as done" (verified by
  Moodle's own `status: true`), then a view of the page for view-completion
  items (verified by re-reading course state). Items that need a score or a
  submission are reported with that reason.
- Graded quizzes & assignments: **skipped** — you take these yourself. Mid- and
  end-semester tests are never touched.
- Forums that require a reply: if the user provides reply messages, one is picked
  at random and posted to an existing discussion (never a new topic — the API
  blocks that), then verified. It won't double-post if you already replied. With
  no messages set, the forum is reported as needing a manual reply.
- Nothing is reported "done" on a guess; unknown types surface in the report.

## Run locally

```bash
npm install
cp .env.example .env.local   # set SESSION_SECRET (required)
npm run dev                  # http://localhost:3000
```

`SESSION_SECRET` is the only required env var. Without the storage env vars
(see `.env.example`), Gists and the footer metric simply switch off — the core
completion app works fully.

## Deploy (free)

Deploy to Vercel. Set `SESSION_SECRET` in project env vars (Production, Preview,
Development). For Gists + metrics, provision the database from the Vercel
Marketplace and set its env vars. Node runtime is used for the API routes
(Moodle calls need manual cookie handling); `/api/run` is capped at 60s and
the engine budgets 45s per pass. Run `npm run db:push` after pulling schema
changes (adds `completion_outcomes`).

## Security & privacy

- The Moodle session is AES-GCM encrypted in an httpOnly cookie; the browser
  never sees raw Moodle cookies, and nothing about the login is stored
  server-side.
- Credentials are used once to log in and are not persisted.
- Run history and forum reply messages live only in the browser's local storage.
- Gists are anonymous: posts are stored with a one-way salted hash, never an
  email. See `app/privacy` for the full policy.
