import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Miva Cliq processes, what it never stores, and what lives only on your device.",
};

const LAST_UPDATED = "17 July 2026";

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
            {`Your login password is sent to our server only to log you in to your learning platform. It is not written to any database, log, or file, and there is no user database here.`}
          </li>
          <li>
            {`The session that logging in produces is encrypted and kept in a cookie in your own browser. Your browser never sees the raw underlying session, and it expires on its own (currently after about two hours).`}
          </li>
          <li>
            {`We don't build profiles of you and we don't track you across the web.`}
          </li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-custom">2. WHAT STAYS ON YOUR DEVICE</span>
        <h2 className="doc-title">Your history is local</h2>
        <p className="doc-body">
          {`Your run history, your saved forum reply messages, and similar preferences are stored in your browser's local storage on the device you're using. They are not uploaded to us. Clear your browser data and they're gone. If you use a shared device, anyone using that browser could see them.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">3. COMMUNITY POSTS (GISTS)</span>
        <h2 className="doc-title">Public and anonymous</h2>
        <ul className="doc-list">
          <li>
            {`Anything you post to `}
            <Link className="miva-link" href="/gists">
              Gists
            </Link>
            {` is public to anyone who can see the board. Don't post anything private or identifying that you wouldn't want others to read.`}
          </li>
          <li>
            {`Posts are not shown with your name or email. To keep spam out, we store a one-way salted hash tied to your login, plus limited technical data such as your IP address, used only to rate-limit abuse. The hash cannot be turned back into your identity.`}
          </li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">4. ACTIONS ON YOUR BEHALF</span>
        <h2 className="doc-title">Forum replies you author</h2>
        <p className="doc-body">
          {`If you turn on forum auto-reply and provide reply text, the Service posts that text to forums on your learning platform, as you. Those posts are made with your account and are visible to your class. We do not write them for you — the words are the ones you supplied — and we keep no copy beyond what's needed to carry out the run you asked for.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">5. AGGREGATE COUNTS</span>
        <h2 className="doc-title">Numbers, not people</h2>
        <p className="doc-body">
          {`We may keep simple aggregate counts — such as how many people have used the Service and how many runs have happened — to understand usage. These are counts, not records about you, and unique users are counted using a one-way hash rather than any readable identifier.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-custom">6. THIRD PARTIES</span>
        <h2 className="doc-title">Who else is involved</h2>
        <ul className="doc-list">
          <li>{`Hosting and storage providers run the servers and databases the Service uses. Your requests pass through them.`}</li>
          <li>{`Your learning platform (the LMS) receives the logins and actions you instruct the Service to perform, exactly as if you did them yourself.`}</li>
          <li>{`If advertising is added in future, an ad provider may collect data through your browser under its own policy. We'll note it here if and when that happens.`}</li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">7. SECURITY — HONESTLY</span>
        <h2 className="doc-title">We try, but we can&apos;t promise</h2>
        <p className="doc-body">
          {`We take reasonable steps to protect the Service and to hold as little of your data as possible. But no system is ever 100% safe from attackers, and we cannot and do not guarantee that the Service is secure. If your own device, browser, or network is already compromised, an attacker there may be able to access your data regardless of anything we do. You use the Service at your own risk.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">8. YOUR CHOICES</span>
        <h2 className="doc-title">You&apos;re in control</h2>
        <ul className="doc-list">
          <li>{`Stop using the Service at any time — there's no account to close.`}</li>
          <li>{`Clear your browser data to remove everything stored on your device and to end your session.`}</li>
          <li>{`Don't post to community spaces if you'd rather leave nothing behind there.`}</li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">9. CHANGES &amp; CONTACT</span>
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
