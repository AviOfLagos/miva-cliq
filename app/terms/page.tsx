import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "The terms you agree to by using Miva Cliq. Use is at your own risk; the operator accepts no liability.",
};

const LAST_UPDATED = "17 July 2026";

/**
 * Plain-language terms. This is a draft for a personal, non-commercial project
 * and is not legal advice — have a lawyer review before relying on it.
 */
export default function TermsPage() {
  return (
    <section className="fade-in doc-wrap">
      <div className="doc-head">
        <h1 className="section-title">Terms of Use</h1>
        <p className="subtle">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">THE SHORT VERSION</span>
        <h2 className="doc-title">Use it at your own risk</h2>
        <p className="doc-body">
          {`Miva Cliq is a small personal project, shared with people who asked for access. It's provided free, "as is", with no guarantees. If you use it, you do so entirely at your own risk, and you accept that the people who built it are not responsible for anything that happens as a result. If that isn't acceptable to you, please don't use it.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">1. WHO THIS IS FOR</span>
        <h2 className="doc-title">A personal project, shared on request</h2>
        <p className="doc-body">
          {`Miva Cliq ("the Service") is a personal, non-commercial project made by an individual ("we", "us", "the operator") for our own use. We chose to expose it to a small number of people who requested access. We are not a company, we are not selling anything, and we make no promises of support, uptime, or fitness for any purpose.`}
        </p>
        <p className="doc-body">
          {`By accessing or using the Service in any way, you agree to these Terms of Use and to our `}
          <Link className="miva-link" href="/privacy">
            Privacy Policy
          </Link>
          {` and `}
          <Link className="miva-link" href="/disclaimer">
            Disclaimer
          </Link>
          {`. If you do not agree, do not use the Service.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-custom">2. HOW YOU GOT HERE</span>
        <h2 className="doc-title">Invited, or found the link anyway</h2>
        <p className="doc-body">
          {`Access is normally shared directly with individuals who asked for it. If you received the link second-hand — from a friend, a group chat, or anywhere else — these same terms apply to you in full, and you use the Service at your own risk just like everyone else.`}
        </p>
        <p className="doc-body">
          {`We have no interest in who you are or in your data, and we take no responsibility for how the Service reaches you or how you choose to use it. We did not build this to profit from you, and we owe you nothing.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">3. YOUR ACCOUNT, YOUR RESPONSIBILITY</span>
        <h2 className="doc-title">You are responsible for what you do</h2>
        <ul className="doc-list">
          <li>
            {`You may only use credentials and accounts that belong to you. You are solely responsible for anything done through your own login.`}
          </li>
          <li>
            {`When you run a task, you are instructing the Service to act on your behalf on your own learning platform. Any action it takes — including completing activities or posting forum replies using text you supply — is your action and your responsibility.`}
          </li>
          <li>
            {`You must be old enough to enter into these terms and to use the platforms you connect to it.`}
          </li>
        </ul>
      </div>

      <div className="card doc-card doc-card-accent">
        <span className="badge badge-custom">4. THE IMPORTANT PART</span>
        <h2 className="doc-title">Rules, institutions, and consequences</h2>
        <p className="doc-body">
          {`Your school, university, or any platform you connect to the Service has its own rules, policies, and codes of conduct. Following them is entirely your responsibility. Using the Service may be against those rules.`}
        </p>
        <p className="doc-body">
          {`We accept no liability whatsoever for any consequence you face from any party — including but not limited to school officials, examiners, administrators, your institution, an LMS provider, or anyone else — arising from your use of the Service. That includes any warning, penalty, sanction, loss of marks, suspension, expulsion, disciplinary action, dispute, or any other outcome, of any kind, from any direction. If you use the Service, you accept all of that risk yourself.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">5. WHAT THE SERVICE IS FOR</span>
        <h2 className="doc-title">A community space, plus a utility</h2>
        <p className="doc-body">
          {`The parts of the Service we actively offer are its community features — the discussion and `}
          <Link className="miva-link" href="/gists">
            Gists
          </Link>
          {` spaces where people can post and share. The automation utility is something we built for our own personal use and simply left available. If you choose to use that utility, that is entirely your own business and your own risk, on the terms above.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">6. ACCEPTABLE USE</span>
        <h2 className="doc-title">Don&apos;t abuse it</h2>
        <ul className="doc-list">
          <li>{`Don't use the Service for anything unlawful, or to harm, harass, impersonate, or defraud anyone.`}</li>
          <li>{`Don't post content that is illegal, hateful, threatening, or that violates someone else's rights.`}</li>
          <li>{`Don't attempt to break, overload, reverse-engineer for abuse, or interfere with the Service or the systems it connects to.`}</li>
          <li>{`We may remove content or withdraw access at any time, for any reason or no reason, without notice.`}</li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">7. NO WARRANTY</span>
        <h2 className="doc-title">Provided &ldquo;as is&rdquo;</h2>
        <p className="doc-body">
          {`The Service is provided "as is" and "as available", without warranty of any kind, whether express or implied. We do not warrant that it will be accurate, reliable, secure, uninterrupted, error-free, or that it will produce any particular result. We may change, break, or shut it down at any time without notice.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">8. LIMITATION OF LIABILITY</span>
        <h2 className="doc-title">We are not liable</h2>
        <p className="doc-body">
          {`To the fullest extent permitted by law, the operator will not be liable for any loss or damage of any kind — direct, indirect, incidental, consequential, academic, disciplinary, financial, reputational, or otherwise — arising out of or connected with your use of, or inability to use, the Service. This applies whatever the cause, including data loss, security incidents, downtime, inaccurate results, or actions taken by third parties. Your only remedy if you are unhappy with the Service is to stop using it.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">9. INDEMNITY</span>
        <h2 className="doc-title">You cover us</h2>
        <p className="doc-body">
          {`You agree to indemnify and hold the operator harmless from any claim, loss, liability, or expense arising from your use of the Service, your content, or your breach of these terms.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-custom">10. MONEY</span>
        <h2 className="doc-title">Free now; maybe ads later</h2>
        <p className="doc-body">
          {`The Service is free and non-commercial. We do not charge you and we do not owe you anything. We may, at some point, display advertising or support the project in other ways. If we do, that changes nothing about your rights here: the Service stays "as is", and you are owed no payment, share, refund, or compensation of any kind.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">11. CHANGES &amp; ENDING ACCESS</span>
        <h2 className="doc-title">These terms can change</h2>
        <p className="doc-body">
          {`We may update these terms at any time by posting a new version here. Continuing to use the Service after a change means you accept it. We may also suspend or stop the Service, or your access to it, at any time and without notice.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">12. GOVERNING LAW &amp; CONTACT</span>
        <h2 className="doc-title">The fine print</h2>
        <p className="doc-body">
          {`These terms are governed by the laws of the Federal Republic of Nigeria, without regard to conflict-of-law rules. If any part of these terms is found unenforceable, the rest still applies.`}
        </p>
        <p className="doc-body">
          {`Questions about these terms can be sent to the operator at the contact address shared with you when you were given access.`}
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
