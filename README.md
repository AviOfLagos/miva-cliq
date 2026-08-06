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
  client.ts       /lib/ajax/service.php helper
  courses.ts      list enrolled + resolve preset names -> ids
  activities.ts   core_courseformat_get_state -> normalized activities
  forum.ts        reply to a discussion (mod_forum_add_discussion_post)
lib/completion/   pluggable completion engine
  registry.ts     ORDERED strategy list (first match wins)
  strategies/     gradedSkip, noCompletion, forumReply, manualMarkDone, unknownFallback
  engine.ts       plan() preview + runCourse(opts) executor (streams progress)
lib/run/          client run state (survives navigation)
  AppContext.tsx  the run loop + screen/auth state, mounted in the layout
  history.ts      per-device run history (localStorage, by email)
  prefs.ts        per-device forum reply messages
  sse.ts / types.ts
lib/store/        server storage for Gists + aggregate metrics (needs a DB;
                  degrades to "off" with no env configured)
lib/presets.ts    curated course presets (Computer Engineering · Second Semester)
lib/session.ts    AES-GCM sealed session cookie
app/api/          login, courses, presets, plan, run (SSE), logout, gists, metrics
app/page.tsx      UI: login -> choose (preset|custom) -> live progress
app/gists/        anonymous community board
app/how-it-works/, app/terms/, app/privacy/, app/disclaimer/   info + legal
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the PR flow, and the two rules
that aren't negotiable: graded work is never touched, and no identifying data is
ever stored.

## Adding a completion method

The LMS will change, or a new activity type will appear. To handle it:

1. Add `lib/completion/strategies/yourStrategy.ts` implementing the `Strategy`
   interface (`detect` / `run`, `action` badge).
2. Register it in `lib/completion/registry.ts` at the right priority.

No engine changes. A strategy gets a `StrategyContext` with `mark` / `view` /
`verify` / `replyToForum` helpers and the user's `forumTexts`. Example future
strategy: `aiQuizAnswer` (attempt ungraded weekly tests) — register it before
`gradedSkip`.

## Completion policy

- Content (pages, videos, readings, urls): manual "mark as done", with a
  view-completion fallback. Verified against Moodle's own status response.
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
(Moodle calls need manual cookie handling); `/api/run` is capped at 60s.

## Security & privacy

- The Moodle session is AES-GCM encrypted in an httpOnly cookie; the browser
  never sees raw Moodle cookies, and nothing about the login is stored
  server-side.
- Credentials are used once to log in and are not persisted.
- Run history and forum reply messages live only in the browser's local storage.
- Gists are anonymous: posts are stored with a one-way salted hash, never an
  email. See `app/privacy` for the full policy.
