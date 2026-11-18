# Miva Cliq: mobile app plan

Written 2026-11-17. This comes after the web app in
[web-app-plan.md](web-app-plan.md). Nothing here should start until the
conditions below are met.

## When to build it

A student will not install an app from a product they have not used. So the
native app waits until the web app shows a habit:

- at least 30 percent of new students return the next day,
- at least a few hundred students practising weekly,
- the installable web app (stage 6) is in use and students are asking for
  better reminders or offline use.

If those are not true, an app will not fix it.

## What the app is

The study side only: practice, streak, league, share cards, study prompts,
gists. It is a quiz and habit app for Miva courses.

Autopilot stays on the web. An app that automates a university's LMS is
likely to be rejected by the App Store and Play Store, and would put the
whole listing at risk. The app can link out to it.

## How to build it

- **Expo (React Native)**, one codebase for Android and iPhone. Android
  first: it is what most Nigerian students carry.
- The app talks to the same API as the web app. Stage 1's 30-day Cliq
  session becomes a token the app stores. No new backend.
- Login opens the Miva sign-in inside the app once, then the app keeps its
  own session.
- Small download and light on data. Questions for the current week are
  stored on the phone so practice works offline and syncs later.

## Releases

### Release 1: the habit

- Login, your courses, the weekly path.
- Practice sets with instant feedback.
- XP and streak.
- One daily reminder, sent at the time the student usually practises.
- Offline practice for downloaded weeks.

### Release 2: the class

- Weekly league with promotion and demotion.
- Share cards straight to WhatsApp and Instagram stories.
- Streak freeze.
- A home-screen widget showing the streak.

### Release 3: the community

- Gists with upvotes and credits.
- Study prompts with one-tap "open in ChatGPT / Gemini".
- Daily quests.
- Friend and class streaks.

### Release 4: the polish

- A mascot that reacts to streaks and league results.
- Sound and animation on set completion.
- Timed rapid rounds before exams.
- End-of-semester summary card.

## Decisions to make before starting

- Whether credits can be bought in the app. Apple and Google take a cut of
  in-app purchases and have rules about it. Simplest is to sell nothing in
  the first releases.
- The name on the store listing and whether it mentions Miva. Using the
  university's name without permission can get a listing removed.
- Who owns the developer accounts (Apple costs 99 dollars a year, Google 25
  once).
