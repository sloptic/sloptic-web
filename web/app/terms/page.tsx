import type { Metadata } from "next";
import { ANON_REPORT_DAYS } from "@/lib/retention";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The rules for using Sloptic, what you may point it at, and what a grade does not claim.",
};

const UPDATED = "1 September 2026";

export default function TermsPage() {
  return (
    <>
      <div className="page-head">
        <h1>Terms of use</h1>
        <p className="page-lead">Last updated {UPDATED}.</p>
      </div>

      <div className="callout" data-tone="warn">
        <p className="callout-label">draft</p>
        <p>
          This is a working draft, not reviewed by a lawyer. It describes what Sloptic actually does
          today and is written for accuracy. The sections on testing sites you
          do not own, and on liability, are the ones a lawyer should see before this is relied on.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">What Sloptic is</h2>
        <p className="section-intro">
          Sloptic grades a deployed web app from outside it, over the public internet, with no source
          code and no access to your systems. It returns a slop score, a breakdown, and a report. It is
          operated by Ian Sun. Contact:{" "}
          <a href="mailto:hello@sloptic.org">hello@sloptic.org</a>.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What you may point it at</h2>
        <p className="section-intro">
          <b>Submit a URL only if you own the app, are authorized to test it, or are running an event
          the app was entered into.</b> This is the central rule of this document. You are responsible
          for the addresses you submit, and by submitting one you confirm you have the right to have it
          tested.
        </p>
        <p className="section-intro">
          Two tiers exist because they carry different risk. The default tier is passive. It reads only
          what the app already serves to any visitor, which is no different from loading the site in a
          browser, and it runs no attacks of any kind. The active tier sends real attack traffic,
          including injection payloads and malformed input, and it runs only after ownership of the
          domain has been proven or an event organizer has verified the event.
        </p>
        <p className="section-intro">
          You may not use Sloptic to test infrastructure you do not control, to attempt denial of
          service, to work around a bot challenge or a rate limit, or to gather information for
          unauthorized access. We may refuse or stop any grade.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Events</h2>
        <p className="section-intro">
          An organizer who verifies control of an event may grade the entries in it and publish a board.
          Verification means publishing a link we issue on the event&apos;s own pages, which only its
          administrators can edit. That link is also the notice to participants that entries are
          graded, and it explains what an active grade does.
        </p>
        <p className="section-intro">
          Active grading of an event requires that the disclosure was published before the submission
          window closed. A notice shown after an event ended was shown to nobody. Entries are taken
          from the addresses teams published themselves. An entry that points at a third party
          product is skipped, because a team cannot consent on another company&apos;s behalf. A team may opt out of being graded.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Reports</h2>
        <p className="section-intro">
          A report lives at an unguessable link, and that link is the only thing that opens it. Anyone
          holding it can read the report and can delete it. Treat it as private and share it
          deliberately. We ask search engines not to index report pages.
        </p>
        <p className="section-intro">
          A report from a grade no account has claimed is deleted {ANON_REPORT_DAYS} days after it
          runs. Sign in and save a grade to keep it. See the{" "}
          <a href="/privacy">privacy policy</a> for what is kept and for how long.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">If your app was graded and you did not ask</h2>
        <p className="section-intro">
          Anyone can run a passive grade on a public URL, so a report may exist about an app you built
          without your involvement. You can delete it yourself using its link, or write to{" "}
          <a href="mailto:hello@sloptic.org">hello@sloptic.org</a> and we will remove it. You do not
          need an account and you do not need to explain why.
        </p>
      </section>

      <div className="method" data-tone="limits">
        <h2>What a grade does not claim</h2>
        <p>
          <b>A grade is not a security certification.</b> A score of 0 means nothing was found.
          Sloptic checks a fixed floor, it cannot see everything, and a clean
          passive result in particular means only that nothing was visible from the outside, because
          the passive tier runs no security attacks at all. Treat any score as a minimum.
        </p>
        <p>
          <b>The service is provided as is</b>, without warranties of any kind, and may be unavailable,
          change, or lose queued work. Grading runs on limited hardware and we may refuse, delay, or
          drop grades. To the extent the law allows, we are not liable for damages arising from use of
          the service or reliance on a grade.
        </p>
        <p>
          <b>These terms may change.</b> Continued use after a change means you accept it, and the date
          at the top says when it last moved. Governing law and jurisdiction are to be settled before
          this leaves draft.
        </p>
      </div>
    </>
  );
}
