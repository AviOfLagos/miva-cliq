# Miva Cliq

Browserless auto-completion for the Miva Open University (Moodle) LMS. Replaces
the old Playwright bot: no browser, no fixed sleeps, runs on a free serverless
tier, multi-user, and verifies every completion instead of assuming it.

## Why it's fast

Miva's LMS is Moodle 5.0. "Mark as done" is a Moodle AJAX call, and login — though
fronted by a CAS SSO portal — reduces to three HTTP requests. So the whole flow is
plain `fetch`: log in, list activities, fire completion calls (parallelizable),
confirm state. A full account completes in seconds-to-minutes vs. the old bot's hours.
See `../PROBE-FINDINGS.md` for the reverse-engineering details.

## Architecture

```
lib/moodle/       browserless Moodle client
  auth.ts         CAS login -> MoodleSession {cookies, sesskey}
  client.ts       /lib/ajax/service.php helper
  courses.ts      list enrolled + resolve preset names -> ids
  activities.ts   core_courseformat_get_state -> normalized activities
lib/completion/   pluggable completion engine
  registry.ts     ORDERED strategy list (first match wins)
  strategies/     gradedSkip, noCompletion, forumReply, manualMarkDone, unknownFallback
  engine.ts       plan() preview + runCourse() executor (streams progress)
lib/presets.ts    curated course presets (Computer Engineering · Second Semester)
lib/session.ts    AES-GCM sealed session cookie
app/api/          login, courses, presets, plan, run (SSE), logout
app/page.tsx      UI: login -> choose (preset|custom) -> live progress
```

## Adding a completion method

The LMS will change, or a new activity type will appear. To handle it:

1. Add `lib/completion/strategies/yourStrategy.ts` implementing the `Strategy`
   interface (`detect` / `run`, `action` badge).
2. Register it in `lib/completion/registry.ts` at the right priority.

No engine changes. Example future strategies: `aiQuizAnswer` (attempt ungraded
weekly tests), `forumPostReply` (post a real reply to complete post-required forums).

## Completion policy

- Content (pages, videos, readings, urls): manual "mark as done", with a
  view-completion fallback. Verified against Moodle's own status response.
- Graded quizzes & assignments: **skipped** — you take these yourself. Mid- and
  end-semester tests are never touched.
- Forums needing a reply: attempted, and honestly reported as failed if a real
  reply is required (post it manually for now).
- Nothing is reported "done" on a guess; unknown types surface in the report.

## Run locally

```bash
npm install
cp .env.example .env.local   # set SESSION_SECRET
npm run dev                  # http://localhost:3000
```

## Deploy (free)

Deploy to Vercel. Set `SESSION_SECRET` in project env vars. Node runtime is used
for the API routes (Moodle calls need manual cookie handling).

## Security

- The Moodle session is AES-GCM encrypted in an httpOnly cookie; the browser
  never sees raw Moodle cookies, and nothing is stored server-side.
- Credentials are used once to log in and are not persisted.
