import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Report an issue",
  description: "How to tell us a grade is wrong, and how to report a vulnerability in Sloptic.",
};

// The page exists because "email us" already did not work. hello@sloptic.org sits in the colophon of
// every page, in /terms, in /privacy and in the participant notice, and a bare address gets back
// "your tool is broken" with no link and no check id, which cannot be acted on. So this page is not
// a contact page. It is two forms with no form: what to include so a dispute is triageable, and what
// is in scope so a curious reader does not treat the grading worker as a target.
export default function ReportIssuePage() {
  return (
    <>
      <div className="page-head">
        <h1>Report an issue</h1>
        <p className="page-lead">
          Something wrong with a grade, or something wrong with Sloptic itself. Both go to the same
          address, and both are easier to fix with a few details.
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">A grade looks wrong</h2>
        <p className="section-intro">
          Sloptic reads an app from the outside with no source and no spec, so it gets things wrong.
          It can miss a control it cannot see, or deduct for something you handle elsewhere. Tell us
          and we will look.
        </p>
        <p className="section-intro">
          Email{" "}
          <a href="mailto:hello@sloptic.org?subject=Grade%20dispute">hello@sloptic.org</a> with:
        </p>
        <ul className="how-to">
          <li>The link to the report. Every grade has a permanent one.</li>
          <li>
            Which check you are disputing. Each finding carries its id, like{" "}
            <span className="mono">sec-headers-001</span>. <a href="/checks">All of them are listed here</a>.
          </li>
          <li>What you think the right answer is, and how you would check it.</li>
        </ul>
        {/* Says why the check id is the part that matters, since it is the part people leave out. */}
        <p className="section-intro">
          The check id is the useful part. A check that is wrong is wrong for every app it has ever
          run against, so fixing one is worth more than fixing your report.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">You want a grade taken down</h2>
        <p className="section-intro">
          Anyone can grade an app they do not own, so a report can be about you without you asking
          for it. Every report has a delete button on it, and you do not need an account to use it.
          If you would rather we did it, email{" "}
          <a href="mailto:hello@sloptic.org?subject=Remove%20a%20grade">hello@sloptic.org</a>. No
          reason is needed. The same goes for an event entry: see <a href="/terms">the terms</a>.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">A vulnerability in Sloptic</h2>
        <p className="section-intro">
          Sloptic grades other people's apps for this, so it should be able to hear about its own.
          Email <a href="mailto:hello@sloptic.org?subject=Security%20report">hello@sloptic.org</a>{" "}
          with what you found and how to reproduce it. Report it to us before anywhere else and we
          will not come after you for it. There is no bounty, only credit if you want it.
        </p>
        <p className="section-intro">In scope: sloptic.org and its API.</p>
        {/* The scope limit that actually matters. A reader who wants to stress test something will
            reach for the queue, and the queue is one desktop in a house, on a home connection,
            deliberately (a datacenter IP gets challenged, which would make the population
            ungradeable). Saying so is more effective than a rate limit at stopping a well meant
            load test, because the person doing it does not know what is on the other end. */}
        <p className="section-intro">
          Not in scope, and please do not: load testing, bulk grade submissions, or anything aimed at
          the grading queue. The worker is a single desktop in a house, on a home connection, and it
          is that way on purpose. A few thousand submitted grades is not research, it is a denial of
          service against one machine.
        </p>
        <p className="section-intro">
          Also not in scope: the apps Sloptic has graded. Those are not ours, and a finding in a
          report belongs to whoever runs that app, not to us.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Anything else</h2>
        <p className="section-intro">
          Same address: <a href="mailto:hello@sloptic.org">hello@sloptic.org</a>. One person runs
          this, so a reply may take a few days.
        </p>
        <div className="cta-row">
          <a className="button secondary" href="/methodology">
            How grading works
          </a>
          <a className="button secondary" href="/checks">
            Every check
          </a>
        </div>
      </section>
    </>
  );
}
