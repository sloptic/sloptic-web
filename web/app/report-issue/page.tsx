import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Report an issue",
  description: "How to tell us a grade is wrong and how to report a vulnerability in Sloptic.",
};

// The page exists because "email us" already did not work. hello@sloptic.org sits in the colophon of
// every page, in /terms, in /privacy and in the participant notice, and a bare address gets back
// "your tool is broken" with no link and no check id, which cannot be acted on. So this page is not
// a contact page. It is forms with no form: what to include so a dispute is triageable, and what is
// in scope so a curious reader does not treat the grading worker as a target.
//
// Which address each section names is deliberate. security@ and abuse@ are the two a person or their
// tooling will try without being told, and splitting them off is what lets either be answered on its
// own schedule. hello@ keeps the disputes because /terms and /privacy already promise that address
// for the takedown route, and those two are the operative documents: a page that quietly sent people
// somewhere else would be contradicting them. postmaster@ is mail plumbing and belongs on no page.
export default function ReportIssuePage() {
  return (
    <>
      <div className="page-head">
        <h1>Report an issue</h1>
        <p className="page-lead">
          Grade disputes and issues with Sloptic itself are handled here.
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">Does a grade look wrong?</h2>
        <p className="section-intro">
          Because Sloptic reads an app from the outside like a visitor would, with no source code or spec, 
          it can get things wrong. Every DAST tool does. It can miss a control or deduct points for something you handle elsewhere 
          or might actually be the correct behavior. Tell us and we will look.
        </p>
        <p className="section-intro">
          Email{" "}
          <a href="mailto:hello@sloptic.org?subject=Grade%20dispute">hello@sloptic.org</a> with:
        </p>
        <ul className="how-to">
          <li>The link to the report (with a UUID).</li>
          <li>
            Which check(s) you are disputing. Each finding carries an id, like{" "}
            <span className="mono">sec-headers-002</span> for content security policy. You can find them
            in your report.
          </li>
          <li>What you think the right answer is and how you would check it.</li>
        </ul>
      </section>

      {/* The one path here that does not begin with the reader having asked us for anything. Sloptic
          sends requests at apps other people submit, so a site operator's first sight of it is their
          own logs, and without a route they reach for a blocklist instead of an address. A scanner
          that gets blocked instead of emailed stops being able to measure the population it exists
          to measure. */}
      <section className="section">
        <h2 className="section-head">Is Sloptic making requests to your site?</h2>
        <p className="section-intro">
          Sloptic grades what people submit to it, so someone will have pointed it at your app. If
          you want that to stop, email <a href="mailto:abuse@sloptic.org">abuse@sloptic.org</a> with
          the origin and we will block it from being graded again, by anyone. No reason is needed,
          and you do not have to prove the site is yours to ask us to leave it alone.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">A vulnerability in Sloptic?</h2>
        <p className="section-intro">
          Sloptic grades other people's apps for this, so it should be able to hear about its own.
          Email <a href="mailto:security@sloptic.org">security@sloptic.org</a> with what you found
          and how to reproduce it. Report it to us before anywhere else and we
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
          <a href="mailto:hello@sloptic.org">hello@sloptic.org</a>. One person runs this, so a
          reply may take a few days.
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
