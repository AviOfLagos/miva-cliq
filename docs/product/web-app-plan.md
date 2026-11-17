# Miva Cliq: web app plan

Written 2026-11-17. This is the plan for turning Miva Cliq from a one-shot
coursework tool into a study product students open every day. Web first; the
mobile plan is in [mobile-app-plan.md](mobile-app-plan.md). The mechanics we
borrow from Duolingo are in [duolingo-playbook.md](duolingo-playbook.md).

## The product in one paragraph

A Miva student logs in with their Miva account. We work out their department,
level and this semester's courses without asking. Autopilot clears the
click-through coursework. Then, for every course and every week, we hand them
a ready-made study prompt to paste into ChatGPT, Gemini or Grok, and a short
quiz drawn from a question bank that every student before them has helped
grow. Answering questions earns XP, keeps a streak alive and moves them up a
weekly league with their classmates. Posting gists that classmates upvote
earns credits, and credits pay for the AI work. When they top the table or
finish a course, they get a card worth posting in the class WhatsApp group,
and the card carries a link back to us.

## Three parts, one loop

| Part | Job | State today |
|---|---|---|
| **Autopilot** | Brings students in. Clears the LMS coursework. | Live, but broken for most runs. See [stage 0](../build/stage-0-completion-and-levels.md). |
| **Study** | Keeps them. Prompts, quizzes, exam readiness. | A course export and an answer bank exist. No practice mode. |
| **Gists** | Gives them a reason to talk, and gives us a currency. | Live, quiet. Nothing rewards posting. |

The loop that makes it grow:

1. A student arrives for Autopilot.
2. Login tells us their courses, so the study page is already filled in.
3. They take a five-question quiz. First XP, streak day one.
4. A reminder brings them back tomorrow to protect the streak.
5. On Sunday the league closes. Winners get a share card.
6. The card lands in a WhatsApp group. Classmates tap the link. Back to 1.

## Where the plan improves on the first idea

**Generate once, serve forever.** The AI cost should follow the number of
courses, not the number of students. A week of COS 301 is generated the first
time anyone asks, saved, and served free to everyone after. With around 30
programmes, 4 levels, 2 semesters and 8 courses each, the whole university is
about 2,000 courses. That is a small, finite bill.

**Study prompts need no AI at all.** A prompt is a template filled with the
course title, the week's topic names from the LMS, and a few questions from
the bank. That is string assembly. It costs nothing, so it ships before any
key or credit system exists.

**Do not deduct points for missing a day.** Duolingo does not take away what
you earned. It makes you lose your *streak* and your *league position*, which
hurts just as much and does not feel like theft. Taking credits from students
who paid for them with effort will push them out. Use streaks, streak
freezes and weekly demotion instead. Details in the playbook.

**Pay for upvotes, not for posting.** If a gist earns credits the moment it
is posted, the board fills with junk in a week. Credits should come from
upvotes by distinct classmates, with a daily cap.

**Leagues, not one big leaderboard.** A single table is won by the same five
people forever and everyone else stops looking. Groups of about 30, reset
weekly, mean a new student can win in their first week.

**A login that lasts.** Today the session is the Moodle session and it dies
after two hours. Nobody keeps a daily habit on a product that asks for their
university password every time. Once Miva login proves who they are, we give
them our own 30-day session. Only Autopilot and course sync need the Moodle
session.

**Summaries, not copies.** We store what we wrote about a course (outlines,
summaries, questions), not the university's PDFs and videos. Redistributing
their files is the fastest way to get a takedown.

## Stages

Each stage is shippable on its own and ends with something a student can see.

### Stage 0: make Autopilot work again

Completion fell from 70 to 80 percent to about 10 percent. Two causes are
visible in the code; a third may be on the LMS side and needs a logged-in
look. Full detail and the fix are in
[stage-0-completion-and-levels.md](../build/stage-0-completion-and-levels.md).

Done when: a fresh-semester account with seven courses finishes above 80
percent of markable items, and every item that fails says why.

### Stage 1: know the student

- Detect level and semester from the courses they are enrolled in.
- Replace the single hard-coded preset with "Your courses this semester",
  picked automatically.
- Build the recommended course list per department and level from what
  students at that level are actually enrolled in, so it fills itself in.
- Ask for department once if we cannot tell.
- Save each course's outline (weeks and topic names) in a shared table, so
  study content does not need the LMS after the first sync.
- Give the student a 30-day Cliq session after the Miva login.

Done when: a 300-level student logs in and sees their own 300-level courses
selected without touching anything.

### Stage 2: study prompts (no AI)

- After login, one question: "Want a study plan for your courses?"
- A study page per course, one card per week: what to know this week, and a
  **Copy prompt** button.
- The prompt asks the AI to teach the week's topics, quiz the student and
  check their answers. Three variants: learn it, test me, explain my mistake.
- "Open in ChatGPT" and "Open in Gemini" links with the prompt pre-filled
  where those apps allow it.

Done when: a student can go from login to a pasted prompt in under a minute.

### Stage 3: question bank and practice

- Practice mode: five questions at a time, instant feedback, one tap each.
- Questions come from the shared bank. The bank already holds answers from
  Autopilot's ungraded quizzes; this stage adds generated ones.
- If a course-week has fewer than about 20 questions, the first student to
  open it generates more. Everyone after gets them free.
- **Bring your own key.** A page shows how to get a free Gemini key in two
  minutes. The key stays in the student's browser, is sent with the request
  and is never stored by us.
- Quality control: a question is "unconfirmed" until enough students have
  answered it without reporting it. A report button on every question.
- Missed questions come back later (spaced repetition, kept simple).
- Courses that already have plenty of questions are skipped; generation
  budget goes to the thin ones.
- PDFs: summarise once per file with the student's key, save the summary and
  questions for everyone. Videos: use the title and any transcript; skip the
  rest for now.

Done when: two students on the same course see overlapping questions and the
second one triggered no AI call.

### Stage 4: XP, streaks, leagues, share cards

- XP for every correct answer, with a small bonus for a perfect set.
- Daily streak, with one free streak freeze a week.
- Weekly league of about 30 students from the same level. Top 5 move up,
  bottom 5 move down. Resets Sunday night, Lagos time.
- "Exam ready" meter per course: the share of that course's questions the
  student has got right recently.
- Share cards as images: top of the league, 7-day streak, course at 80
  percent ready. Each card has a short link with the student's referral code.
  WhatsApp share first, since that is where class groups live.
- Leaderboards use the chosen handle. Students without one appear as
  "Anonymous" until they pick one. Gists stay anonymous by default.

Done when: a share card posted in a WhatsApp group shows a preview image and
the link signs a new student up with the referrer credited.

### Stage 5: credits, and gists as currency

- Credits pay for AI generation on our key. BYOK remains as the alternative
  until this is stable, then it is retired.
- Ways to earn: upvotes on your gists from distinct classmates, daily
  practice, referrals that sign up, being first to open a course-week.
- Weekly gist starters: three or four topics students already argue about
  (lecturers, exam timetable, fees, portal outages).
- Validity check before a gist can earn: minimum length, not a duplicate, a
  cheap AI check for spam. Earning is capped per day.
- Paying with money comes last, once credits have a known value.

Done when: a student with no API key can generate a week of questions using
credits earned from gist upvotes.

### Stage 6: installable web app

- Add to home screen with an icon and full-screen launch (a PWA).
- Push reminders for streaks. Works on Android in the browser; on iPhone it
  works once the app is added to the home screen.
- Offline practice for questions already loaded.

This is the bridge to mobile. If the PWA holds a daily habit, the native app
is a port, not a bet.

## Risks to keep in view

- **The university.** Autopilot and AI answers on ungraded quizzes are the
  parts Miva could object to. The study side is the part we can defend and
  the part that lasts. Over time the front door should be study, with
  Autopilot as a feature inside it.
- **Wrong answers in the bank.** One confident wrong answer shared with a
  whole class is worse than no answer. Confirmation counts and the report
  button are not optional.
- **Farming.** Any way to earn will be gamed. One Miva login is one person,
  which is our best defence; caps and distinct-voter rules do the rest.
- **Passwords.** We never store them. A longer Cliq session must not keep
  the Moodle cookies around longer than it does today.

## What to measure

- Autopilot: percent of markable items completed per run.
- Day-1 and day-7 return rate.
- Share of logins that answer at least one practice question.
- Questions in the bank, and AI calls per question served.
- Share cards created, and signups per card.
