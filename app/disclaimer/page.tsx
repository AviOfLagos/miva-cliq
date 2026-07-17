import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Disclaimer",
  description:
    "Miva Cliq is a personal project provided as is, at your own risk, with no affiliation to any institution.",
};

const LAST_UPDATED = "17 July 2026";

/** Draft disclaimer for a personal, non-commercial project. Not legal advice. */
export default function DisclaimerPage() {
  return (
    <section className="fade-in doc-wrap">
      <div className="doc-head">
        <h1 className="section-title">Disclaimer</h1>
        <p className="subtle">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="card doc-card doc-card-accent">
        <span className="badge badge-custom">READ THIS</span>
        <h2 className="doc-title">Use at your own risk</h2>
        <p className="doc-body">
          {`Miva Cliq is a personal, non-commercial project provided free and "as is". You use it entirely at your own risk. The people who built it make no guarantees and accept no liability for anything that results from your use of it.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">NO AFFILIATION</span>
        <h2 className="doc-title">Independent and unofficial</h2>
        <p className="doc-body">
          {`Miva Cliq is not affiliated with, endorsed by, sponsored by, or connected to Miva Open University, Moodle, or any school, university, examination body, or software provider. All product and organisation names belong to their respective owners and are used only to describe what the tool interacts with.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">NO GUARANTEES</span>
        <h2 className="doc-title">Nothing is promised</h2>
        <ul className="doc-list">
          <li>{`No guarantee that the Service is accurate, complete, reliable, available, or that it will produce any particular result.`}</li>
          <li>{`No guarantee that it is secure or free from attackers. If your device or network is compromised, your data may be exposed regardless of our efforts.`}</li>
          <li>{`It may change, break, or be shut down at any time without notice.`}</li>
        </ul>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">NO LIABILITY</span>
        <h2 className="doc-title">Consequences are yours</h2>
        <p className="doc-body">
          {`We accept no liability for any consequence of using the Service, from any direction — including academic, disciplinary, or other action from a school, examiner, administrator, institution, or any other party. Following the rules of any platform or institution you connect to it is entirely your responsibility.`}
        </p>
      </div>

      <div className="card doc-card">
        <span className="badge badge-preset">NOT ADVICE</span>
        <h2 className="doc-title">This isn&apos;t advice</h2>
        <p className="doc-body">
          {`Nothing here or elsewhere in the Service is legal, academic, or professional advice. If you're unsure whether using a tool like this is appropriate for your situation, that decision — and its consequences — are yours.`}
        </p>
        <p className="doc-body">
          {`See also our `}
          <Link className="miva-link" href="/terms">
            Terms of Use
          </Link>
          {` and `}
          <Link className="miva-link" href="/privacy">
            Privacy Policy
          </Link>
          {`.`}
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
