import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Miva Cliq processes, what it never stores, and what lives only on your device.",
};

const LAST_UPDATED = "19 November 2026";

/**
 * Describes the data behaviour the code actually implements (lib/session,
 * lib/store, lib/run). If that behaviour changes, this page must change too.
 * Draft only — not legal advice.
 */
export default function PrivacyPage() {
  return (
    <section className="fade-in doc-wrap">
      <div className="doc-head">
        <h1 className="section-title">Privacy Policy</h1>
        <p className="subtle">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">THE SHORT VERSION</span>
        <h2 className="doc-title">We keep as little as possible</h2>
        <p className="doc-body">
          {`Miva Cliq is built to hold almost nothing about you. Your password is used once and never stored. Your history stays on your own device. We can't promise perfect security — nobody honestly can — so please read this and decide for yourself.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">1. YOUR PASSWORD &amp; SESSION</span>
        <h2 className="doc-title">Used once, then gone</h2>
        <ul className="doc-list">
          <li>
            {`Your login password is sent to our server only to log you in to your learning platform. It is never written to any database, log, or file.`}
          </li>
          <li>
            {`The session that logging in produces is encrypted and kept in a cookie in your own browser. Your browser never sees the raw underlying session, and it expires on its own (currently after about two hours).`}
          </li>
          <li>
            {`We don't track you across the web, and we never store your email, password, or real name. The only readable profile is a username, and only if you choose to pick one (see below). Other records, like your practice answers, are tied to a one-way hash rather than to you by name (see sections 3 and 7).`}
          </li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-custom">2. WHAT STAYS ON YOUR DEVICE</span>
        <h2 className="doc-title">Your history is local</h2>
        <p className="doc-body">
          {`Your run history, your saved forum reply messages, your Gemini key if you add one, and similar preferences are stored in your browser's local storage on the device you're using. They are not stored by us. Clear your browser data and they're gone. If you use a shared device, anyone using that browser could see them.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">3. COMMUNITY POSTS (GISTS &amp; EVENTS)</span>
        <h2 className="doc-title">Anonymous by default, or under a handle</h2>
        <ul className="doc-list">
          <li>
            {`Anything you post to `}
            <Link className="miva-link" href="/gists">
              Gists
            </Link>
            {` or `}
            <Link className="miva-link" href="/events">
              Events
            </Link>
            {` is public to anyone who can see the board. Don't post anything private or identifying that you wouldn't want others to read.`}
          </li>
          <li>
            {`Every post is anonymous by default. You can choose to post under a username instead, and replies always show your username. Anonymous posts never display your name or email to other readers.`}
          </li>
          <li>
            {`To keep spam out, each post also carries a one-way salted hash tied to your login, plus limited technical data such as your IP address, used only to rate-limit abuse and to let you edit or delete your own posts. That hash is never shown to anyone.`}
          </li>
        </ul>
      </div>

      <div className="card doc-card doc-card-accent">
        <span className="badge badge-custom">4. USERNAMES</span>
        <h2 className="doc-title">The one profile we keep — if you want it</h2>
        <ul className="doc-list">
          <li>
            {`If you pick a username, we store that handle linked to the internal hash above. That's the whole "account": no password, no email, no signup — your Moodle login is the only credential, and the handle is just a label.`}
          </li>
          <li>
            {`Being honest about anonymity: to other students, "Anonymous" really is anonymous. But because the same internal hash sits on your anonymous and named posts, whoever operates the database could in principle correlate them — the same way the hash and your IP already allow. Reader-facing anonymity is real; anonymity from the operator is not something we can promise.`}
          </li>
          <li>
            {`You can change your username, or delete it entirely and go back to anonymous-only, at any time.`}
          </li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">5. ACTIONS ON YOUR BEHALF</span>
        <h2 className="doc-title">Forum replies you author</h2>
        <p className="doc-body">
          {`If you turn on forum auto-reply and provide reply text, the Service posts that text to forums on your learning platform, as you. Those posts are made with your account and are visible to your class. We do not write them for you — the words are the ones you supplied — and we keep no copy beyond what's needed to carry out the run you asked for.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">6. AGGREGATE COUNTS</span>
        <h2 className="doc-title">Numbers, not people</h2>
        <p className="doc-body">
          {`We may keep simple aggregate counts — such as how many people have used the Service and how many runs have happened — to understand usage. These are counts, not records about you, and unique users are counted using a one-way hash rather than any readable identifier.`}
        </p>
        <p className="doc-body">
          {`Once you confirm your department on the Autopilot screen, we record which course codes you're enrolled in at your level and semester, keyed to the same one-way hash, so we can show which courses most students in your department and level take. We store the department, level, semester and course codes — never your name, email or Moodle user id. Your department choice itself is remembered only in your browser.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-custom">7. PRACTICE &amp; YOUR GEMINI KEY</span>
        <h2 className="doc-title">Your answers, and a key we don&apos;t keep</h2>
        <ul className="doc-list">
          <li>
            {`When you open a course on the Study page, we save that course's week titles and topic names (course information from the learning platform, nothing about you) so practice questions can be made for it later.`}
          </li>
          <li>
            {`When you answer a practice question, we record the question, whether you got it right, and when, keyed to the same one-way hash as above. That is what brings missed questions back after 1, 3 and 7 days, and what future streaks and progress features will count. It is never shown to other students as yours.`}
          </li>
          <li>
            {`Questions you create are saved for everyone on that course, along with the one-way hash of who created them (for abuse control, never shown). If you report a question, we store that report against the same hash so each person counts once.`}
          </li>
          <li>
            {`If you add a Gemini API key, it is kept only in your browser's local storage. When you create questions or test the key, your browser sends it to our server with that single request, and our server passes it to Google to make that call. We do not save the key in any database, file or log, and we never use it for anything else. Google handles that call under its own terms, and it counts against your own free limit. You can remove the key from this browser at any time, or delete it in Google AI Studio.`}
          </li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-custom">8. THIRD PARTIES</span>
        <h2 className="doc-title">Who else is involved</h2>
        <ul className="doc-list">
          <li>{`Hosting and storage providers run the servers and databases the Service uses. Your requests pass through them.`}</li>
          <li>{`Your learning platform (the LMS) receives the logins and actions you instruct the Service to perform, exactly as if you did them yourself.`}</li>
          <li>{`Google (Gemini) receives the course outline and your own key when you choose to create practice questions or test a key. Nothing about you is in that request beyond the key itself.`}</li>
          <li>{`If advertising is added in future, an ad provider may collect data through your browser under its own policy. We'll note it here if and when that happens.`}</li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">9. SECURITY — HONESTLY</span>
        <h2 className="doc-title">We try, but we can&apos;t promise</h2>
        <p className="doc-body">
          {`We take reasonable steps to protect the Service and to hold as little of your data as possible. But no system is ever 100% safe from attackers, and we cannot and do not guarantee that the Service is secure. If your own device, browser, or network is already compromised, an attacker there may be able to access your data regardless of anything we do. You use the Service at your own risk.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">10. YOUR CHOICES</span>
        <h2 className="doc-title">You&apos;re in control</h2>
        <ul className="doc-list">
          <li>{`Stop using the Service at any time — there's no account to close.`}</li>
          <li>{`Clear your browser data to remove everything stored on your device and to end your session.`}</li>
          <li>{`Don't post to community spaces if you'd rather leave nothing behind there.`}</li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">11. CHANGES &amp; CONTACT</span>
        <h2 className="doc-title">Updates</h2>
        <p className="doc-body">
          {`We may update this policy by posting a new version here. Continuing to use the Service after a change means you accept it. Questions can be sent to the operator at the contact address shared with you when you were given access.`}
        </p>
      </div>

      <div className="doc-foot">
        <Link className="btn btn-primary" href="/">
          Back to Miva Cliq <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
