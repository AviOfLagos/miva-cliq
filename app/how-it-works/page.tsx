import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "What Miva Cliq does to your Moodle account, what it deliberately won't touch, and what happens to your password.",
};

/**
 * The trust page. Every claim here is a description of what the code in
 * lib/completion and lib/session actually does — if the behaviour changes,
 * this page changes with it.
 */
export default function HowItWorksPage() {
  return (
    <section className="fade-in doc-wrap">
      <div className="doc-head">
        <h1 className="section-title">How Miva Cliq works</h1>
        <p className="subtle">
          You&apos;re about to hand a tool your LMS password. Here&apos;s exactly
          what it does with it.
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">THE SHORT VERSION</span>
        <h2 className="doc-title">It clicks &ldquo;Mark as done&rdquo; for you</h2>
        <p className="doc-body">
          Miva&apos;s LMS is Moodle. The &ldquo;Mark as done&rdquo; button on a
          reading or video is just a web request. Miva Cliq logs in as you, lists
          your activities, and fires those same requests — the ones you&apos;d
          fire yourself by clicking, only without the waiting.
        </p>
        <p className="doc-body">
          There&apos;s no browser and no robot moving a cursor around. A full
          account finishes in seconds to minutes.
        </p>
      </div>

      <div className="card doc-card doc-card-accent">
        <span className="badge badge-custom">THE IMPORTANT PART</span>
        <h2 className="doc-title">What it will never touch</h2>
        <ul className="doc-list">
          <li>
            <strong className="text-warn">
              Graded quizzes and assignments are skipped.
            </strong>{" "}
            You take those yourself. Mid-semester and end-semester tests are
            never touched — not attempted, not opened, not submitted.
          </li>
          <li>
            <strong>Content is what gets completed.</strong> Pages, videos,
            readings, and links — the items whose only requirement is that you
            marked them done.
          </li>
          <li>
            <strong>Forums post only your words, and only if you opt in.</strong>{" "}
            Some forums only complete once you reply. If you add your own reply
            messages, Miva Cliq posts one of them to those forums for you —
            using text you wrote, as you, visible to your class. Leave that empty
            and it posts nothing: those forums are simply reported so you can
            reply yourself. It never invents words on your behalf.
          </li>
          <li>
            <strong>Unknown activity types surface in the report</strong> rather
            than being quietly marked complete.
          </li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">VERIFICATION</span>
        <h2 className="doc-title">Nothing is reported done on a guess</h2>
        <p className="doc-body">
          When Miva Cliq marks something complete, Moodle replies with its own
          confirmation — the very same signal the &ldquo;Mark as done&rdquo;
          button trusts when you click it. For activities completed by viewing,
          the state is re-read afterwards to confirm it actually stuck.
        </p>
        <p className="doc-body">
          If confirmation doesn&apos;t come back, it&apos;s reported as failed.
          The number you see at the end is what actually happened in your
          account, which you can check on the Miva site itself — every course and
          activity in the report links straight to it.
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">YOUR PASSWORD</span>
        <h2 className="doc-title">Used once, never stored</h2>
        <ul className="doc-list">
          <li>
            Your password is used one time, to log in. It is never written to a
            database, a log, or a file — there is no database of users here.
          </li>
          <li>
            The resulting Moodle session is encrypted (AES-256-GCM) and kept in
            an httpOnly cookie in your own browser. Nothing is stored on the
            server.
          </li>
          <li>
            Your browser never sees the raw Moodle cookies, and the session
            expires on its own after two hours.
          </li>
          <li>
            Your run history is saved on your device only, in this browser&apos;s
            local storage. Clear your browser data and it&apos;s gone.
          </li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-custom">GISTS</span>
        <h2 className="doc-title">Posting anonymously</h2>
        <p className="doc-body">
          <Link className="miva-link" href="/gists">
            Miva Gists
          </Link>{" "}
          is anonymous to everyone reading it. To keep spam out, you have to be
          logged in to post — but your email is never stored alongside a post.
          What&apos;s stored is a one-way salted hash, which is enough to
          rate-limit an abuser and nothing else. There is no way to turn it back
          into your address.
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">HONESTLY, THOUGH</span>
        <h2 className="doc-title">Should you use it?</h2>
        <p className="doc-body">
          Miva Cliq handles the box-ticking — the &ldquo;mark as read&rdquo;
          busywork that Moodle counts but nobody learns from. It does not take
          your tests or write your assignments. It will post a forum reply, but
          only your own words, and only if you switch that on. If a thing is
          actually assessed, it stays yours.
        </p>
        <p className="doc-body">
          Your account, your call. The report tells you the truth either way.
        </p>
      </div>

      <div className="doc-foot">
        <Link className="btn btn-primary" href="/">
          Get started <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}