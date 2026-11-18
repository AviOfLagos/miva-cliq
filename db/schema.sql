-- Miva Cliq schema. Idempotent — safe to re-run. Apply with `npm run db:push`.
--
-- Anonymity note: author_hash is an HMAC of the Moodle userId under a server-only
-- salt (see lib/store/authorHash.ts). It exists so we can rate-limit and clean up
-- after an abuser. It is never returned by any API and cannot be reversed into an
-- identity. No email address or password is stored anywhere in this database.
--
-- The one profile we keep is `users`: a chosen handle bound to that same hash.
-- It's the only place a person is "remembered" — and only if they pick a handle.

-- A user-chosen display handle, keyed on the same internal author_hash used for
-- posting. This is the whole "account": no password, no email, no signup — the
-- Moodle login (mc_session cookie) is the only credential. A person only gets a
-- row here if they choose to post under a name or reply.
CREATE TABLE IF NOT EXISTS users (
  author_hash     TEXT PRIMARY KEY,
  username        TEXT        NOT NULL,
  username_lower  TEXT        NOT NULL UNIQUE,   -- case-insensitive uniqueness
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gists (
  id           TEXT PRIMARY KEY,
  body         TEXT        NOT NULL,
  category     TEXT        NOT NULL DEFAULT 'general',
  -- Optional: tagging a department narrows who could have written a post, so the
  -- composer defaults it to NULL and warns before someone opts in.
  department   TEXT,
  author_hash  TEXT        NOT NULL,
  reports      INT         NOT NULL DEFAULT 0,
  hidden       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The feed is always "newest first, not hidden", optionally narrowed by
-- category and/or department. A partial index keeps hidden rows out of the scan.
-- Added after launch; ADD COLUMN IF NOT EXISTS keeps this migration idempotent.
ALTER TABLE gists ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
-- show_author: reveal the poster's handle on this gist? Default false = anonymous.
-- The handle is resolved live from `users` at read time, so a rename propagates.
ALTER TABLE gists ADD COLUMN IF NOT EXISTS show_author BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS gists_feed_idx
  ON gists (created_at DESC) WHERE NOT hidden;
CREATE INDEX IF NOT EXISTS gists_category_idx
  ON gists (category, created_at DESC) WHERE NOT hidden;
CREATE INDEX IF NOT EXISTS gists_department_idx
  ON gists (department, created_at DESC) WHERE NOT hidden;

CREATE TABLE IF NOT EXISTS replies (
  id           TEXT PRIMARY KEY,
  gist_id      TEXT        NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
  body         TEXT        NOT NULL,
  author_hash  TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE replies ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS replies_gist_idx ON replies (gist_id, created_at ASC);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL DEFAULT '',
  starts_at    TIMESTAMPTZ NOT NULL,
  location     TEXT,
  link         TEXT,
  department   TEXT,
  author_hash  TEXT        NOT NULL,
  reports      INT         NOT NULL DEFAULT 0,
  hidden       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS show_author BOOLEAN NOT NULL DEFAULT FALSE;

-- Events sort by when they happen, not when they were posted.
CREATE INDEX IF NOT EXISTS events_upcoming_idx
  ON events (starts_at ASC) WHERE NOT hidden;

-- One report per person per item; the UNIQUE constraint is what enforces it,
-- so a double-click can't bury a post.
CREATE TABLE IF NOT EXISTS reports (
  target_kind  TEXT        NOT NULL,   -- 'gist' | 'event'
  target_id    TEXT        NOT NULL,
  author_hash  TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_kind, target_id, author_hash)
);

-- Rate limiting: one row per action, counted over a sliding window. Cheaper to
-- reason about than a fixed window, and old rows are pruned on write.
CREATE TABLE IF NOT EXISTS rate_events (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT        NOT NULL,   -- author_hash, ip:<addr>, or acct:<hash>
  kind        TEXT        NOT NULL,   -- 'gist' | 'reply' | 'event' | 'quiz-edit' | 'login'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_events_lookup_idx
  ON rate_events (actor, kind, created_at DESC);

-- Unique-user metric. One row per person, ever. Counting rows replaces the
-- HyperLogLog we'd have used in Redis; at this scale an exact count is free.
CREATE TABLE IF NOT EXISTS metric_users (
  author_hash  TEXT PRIMARY KEY,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row counters (runs started, etc).
CREATE TABLE IF NOT EXISTS metric_counters (
  name   TEXT PRIMARY KEY,
  value  BIGINT NOT NULL DEFAULT 0
);

-- Shared answer bank for UNGRADED weekly quizzes only. Keyed on a hash of the
-- normalized question text, NOT on question/option position: Moodle shuffles
-- option order per attempt and can draw different questions per student from a
-- question bank, so a positional key would serve wrong answers. Hashing the text
-- makes the same question dedupe across attempts, weeks, and students.
--
-- Nothing graded is ever stored here (enforced in lib/quiz/run.ts before any
-- attempt). course_code/department/section/semester/year are browse metadata,
-- not part of identity.
CREATE TABLE IF NOT EXISTS quiz_answers (
  question_hash   TEXT PRIMARY KEY,                 -- sha256 of normalized question text
  question_text   TEXT        NOT NULL,
  qtype           TEXT        NOT NULL,             -- multichoice | truefalse (option-based only)
  answer_text     TEXT        NOT NULL,             -- correct option text (matched by text, not position)
  answer_multi    JSONB,                            -- selected option texts for multi-answer multichoice
  status          TEXT        NOT NULL DEFAULT 'unconfirmed',  -- unconfirmed | confirmed
  confirm_count   INT         NOT NULL DEFAULT 0,
  refute_count    INT         NOT NULL DEFAULT 0,
  course_code     TEXT,                             -- e.g. cos202 (browse metadata)
  department      TEXT,                             -- validated slug
  section         INT,                              -- Moodle section ~ week
  semester        TEXT,
  year            INT,
  source          TEXT        NOT NULL DEFAULT 'ai',-- ai | attempt | edit
  author_hash     TEXT,                             -- last contributor (abuse control)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_answers_browse_idx
  ON quiz_answers (course_code, section);

-- Self-building curriculum. One row per (department, level, semester, course
-- code, student), where "student" is the same salted HMAC used for Gists
-- (lib/store/authorHash.ts) and never an email, a name or a Moodle user id.
-- The per-student row is what makes counts distinct: a student who logs in
-- twenty times still counts once. The recommended package for a department,
-- level and semester is the codes a clear majority of those distinct students
-- share (lib/level/package.ts). Recorded only once a department is known. A
-- student's rows for that level and semester are replaced on each record, so a
-- dropped course or a corrected department does not linger.
CREATE TABLE IF NOT EXISTS curriculum (
  department   TEXT        NOT NULL,   -- validated slug from lib/taxonomy.ts
  level        INT         NOT NULL,   -- 100, 200, ...
  semester     TEXT        NOT NULL,   -- first | second
  course_code  TEXT        NOT NULL,   -- display form, e.g. COS 202
  author_hash  TEXT        NOT NULL,
  seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department, level, semester, course_code, author_hash)
);

CREATE INDEX IF NOT EXISTS curriculum_student_idx
  ON curriculum (author_hash, level, semester);