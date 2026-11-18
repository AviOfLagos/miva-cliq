# Contributing to Miva Cliq

Thanks for wanting to help. This file covers how to work on the project, and
two rules that are not negotiable. Please read those two first — everything
else here is mechanics you can pick up as you go.

## The two rules

**1. Graded work is never touched.**

Graded quizzes, assignments, mid-semester and end-semester tests are skipped.
Always. The `gradedSkip` strategy exists to enforce this, and `lib/quiz/run.ts`
checks it again before any quiz attempt is made.

This is the promise the project makes to the students using it: it handles the
busywork of marking readings as done, and it does not sit exams for you. A
change that "improves coverage" by touching graded work breaks that promise and
puts real students at risk of academic misconduct. If you think you have a case
for an exception, open an issue and argue it before writing code — do not send
it as a surprise in a PR.

**2. No identifying data is stored. Anywhere.**

Not in the database, not in logs, not in error messages, not in analytics.

- A password is used once, forwarded to the Miva SIS, and discarded. It is never
  written down.
- An email address is never stored. Where we need a stable identity — counting
  unique users, rate limiting, attributing a Gist — we store an HMAC of it under
  a server-only salt (`lib/store/authorHash.ts`). That is enough to recognise
  "this is the same person as before" and nothing else.
- The only profile that exists is a username, and only if someone chooses one.

Two ways this gets broken by accident, both worth watching for in review:

- A `console.log` added while debugging login. Vercel keeps runtime logs. A
  logged request body is a logged password.
- A new column that seems harmless. Ask what it lets you do that you couldn't do
  with a hash. If the answer is "identify a specific person", it doesn't go in.

When you add an API response, check what it actually serialises.
`toPublic()` in `lib/store/quizAnswers.ts` is the pattern: map explicitly to a
public shape rather than spreading a database row, so a column added later
doesn't leak by default.

## Getting set up

```bash
npm install
cp .env.example .env.local
npm run dev
```

`SESSION_SECRET` is the only required variable — set it to any random string
locally. Without the database variables, Gists, the answer bank, and the footer
metric switch off cleanly; the core completion flow works fully. That is a
supported way to develop.

If you do configure a database, **point it at your own**, not at production.
Local development against the production database means your test data lands in
front of real users.

`GEMINI_API_KEY` enables AI quiz answering. Without it, and without a local
Ollama, `aiConfigured()` returns false and that feature is skipped rather than
erroring.

## How changes get made

`main` is protected. All changes go through a pull request — including small
ones, including from maintainers.

```bash
git checkout main && git pull
git checkout -b short-descriptive-name
# work
git commit
git push -u origin short-descriptive-name
gh pr create
```

Branch names: lowercase, hyphenated, descriptive of the change
(`login-rate-limit`, `answer-bank-pagination`). Prefixes like `fix/` or `docs/`
are fine but not required.

Commit messages in normal English, present tense, explaining **why** where the
why isn't obvious from the diff. The code shows what changed; the message should
show what you were thinking. Reference an issue with `Closes #12` when the PR
closes one.

Before opening a PR:

```bash
npx tsc --noEmit    # typecheck
npm run lint
npm run build       # catches things dev mode doesn't
```

CI runs these on every PR and they must pass before merge.

## Reviewing and merging

Every PR needs a passing CI run and a review. Only the repository owner merges
to `main`. If your PR sits, ping it — that's not rudeness, it's a reasonable
thing to do.

Keep PRs small enough to review honestly. A 2000-line PR gets a worse review
than four 500-line ones, and everyone involved knows it.

## The codebase

The README has the full architecture map. Orientation for the parts you're most
likely to touch:

| Directory | What lives there |
|---|---|
| `lib/moodle/` | Browserless Moodle client — CAS login, AJAX calls, activity listing. Talks to the real LMS. |
| `lib/completion/` | The completion engine and its strategies. First matching strategy wins. |
| `lib/quiz/` | Ungraded quiz attempts and the answer bank write path. |
| `lib/ai/` | Provider abstraction over Gemini and Ollama, with schema-forced output. |
| `lib/store/` | Database access. Everything that persists goes through here. |
| `lib/session.ts` | Session sealing. Small file, high consequence. |
| `app/api/` | Route handlers. All use the Node runtime — Moodle needs manual cookie handling. |

### Adding a completion strategy

The main extension point. The LMS changes, or a new activity type appears:

1. Add `lib/completion/strategies/yourStrategy.ts` implementing `Strategy`
   (`detect` / `run`, plus an `action` badge for the UI).
2. Register it in `lib/completion/registry.ts` at the right priority. Order
   matters — the first strategy whose `detect` matches is the one that runs.

No engine changes needed. Your strategy receives a `StrategyContext` with
`mark` / `view` / `verify` / `replyToForum` helpers.

Verify, don't assume. Every strategy confirms the result against Moodle's own
status response before reporting success. Nothing is reported done on a guess —
a false "done" is worse than an honest "couldn't handle this", because the
student stops checking.

### Working with the answer bank

Answers are keyed on a SHA-256 of the **normalized question text**, never on
question or option position. This is deliberate and load-bearing: Moodle
shuffles option order between attempts and can draw different questions per
student from a question bank, so a positional key would confidently serve the
wrong answer to the wrong question.

If you change the normalization, you change every key. Existing entries become
unreachable and the bank silently starts over. Treat it as a migration, not a
tweak.

## Tests

Tests should not touch the network or a real database. CI has no credentials and
must never need any — keep Moodle and the database behind fixtures.

Worth testing, roughly in order of what happens if it breaks:

- Question-hash normalization — a regression here serves wrong answers to
  students, and does it quietly.
- The graded-quiz exclusion.
- `seal` / `unseal` — round-trip, tampered blob, expired blob.
- `normalizeUsername` boundaries.
- `toPublic()` never emitting `author_hash`.

## Reporting a security problem

Please don't open a public issue. Email the maintainer, or use GitHub's private
vulnerability reporting on this repository. You'll get a response.

This project asks students to hand over an LMS password. That trust is the whole
product, and a report that helps protect it is genuinely welcome — including one
that says we got something wrong.
