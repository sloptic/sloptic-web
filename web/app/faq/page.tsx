import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { ACTIVE, PASSIVE, fireRate, fmt } from "@/lib/corpus";
import { TOTALS } from "@/lib/checks";
import { LIGHTHOUSE_PROFILE as LH, SEAT_ROWS } from "@/lib/seat";

export const metadata: Metadata = pageMeta(
  "Frequently asked questions",
  "Short answers to common questions about Sloptic scores, reports and checks.",
  "/faq",
);

// Each question is a heading with a stable id, so a report or another page can link straight to its
// answer (SEAT_HREF points at #fast-but-bad from every report). Answers stay short and link to the
// page that holds the detail, so a number lives in one place.
export default function FaqPage() {
  return (
    <>
      <div className="page-head">
        <h1>Frequently asked questions</h1>
        <p className="page-lead">Short answers to common questions.</p>
      </div>

      {/* The builder's seat (3.0 handoff), moved here from /methodology. The rails from the handoff
          hold here too: Lighthouse SIMULATES the phone on the grading box, never "tested on a phone",
          and the phone framing is for performance only. */}
      <section className="section" id="fast-but-bad">
        <h2 className="section-head">Why is my score bad when my app is fast?</h2>
        <p className="section-intro">
          Some kinds of slop are easy to miss when you build and test an app yourself. Below are the
          most common ones and how Sloptic checks for each.
        </p>
        {/* Cards, not a table: each row was three sentences about one kind of slop, read on its own and
            never compared column to column, and a phone fits two wordy columns at most. */}
        <ul className="seat-cards">
          {SEAT_ROWS.map((r) => (
            <li className="seat-card" key={r.failure}>
              <h3>{r.failure}</h3>
              <dl>
                <div>
                  <dt>why it&apos;s missed</dt>
                  <dd>{r.invisible}</dd>
                </div>
                <div>
                  <dt>how Sloptic checks</dt>
                  <dd>{r.instead}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <p className="section-intro">
          For performance, Lighthouse measures how the app would load on a mid range phone ({LH.device},
          with a {LH.screen} screen) over slow 4G, i.e. a {LH.rttMs} ms round trip, {LH.downMbps} Mbps
          down, and CPU work taking {LH.cpuSlowdown} times as long. Sloptic simulates this on the machine
          that grades your app. Across the corpus, {fmt(fireRate("perf-lighthouse-001") ?? 0)}% of apps
          scored below 90, and the median score was {fmt(ACTIVE.lighthouse.overall.median)}.
        </p>
        <p className="section-intro">
          For accessibility, {fmt(fireRate("qa-a11y-001") ?? 0)}% of apps had at least one instance of
          slop, and about 4 in 5 of those had text too faint to read against its background.
        </p>
      </section>

      <section className="section" id="secure">
        <h2 className="section-head">Does a low score mean my app is secure?</h2>
        <p className="section-intro">
          No. A 0 means Sloptic found nothing. It cannot tell a defended app from an app with nothing to
          test. A passive grade runs no attack checks at all. Treat the score as a minimum.
        </p>
      </section>

      {/* Moved from /methodology's "What Sloptic can't say" when that section was cut. */}
      <section className="section" id="accuracy">
        <h2 className="section-head">How accurate is Sloptic?</h2>
        <p className="section-intro">
          Every finding rests on evidence. Checks are validated for precision. Classes with precision rules
          are audited. The rest are not yet. The miss rate is not measured yet. Recall is hard to measure
          across such varied apps. Sloptic tracks coverage instead: how much of the battery applied to each
          app. <a href="/methodology">How Sloptic finds slop</a> covers the validation.
        </p>
      </section>

      <section className="section" id="some-checks">
        <h2 className="section-head">Why did only some checks run?</h2>
        <p className="section-intro">
          An unverified app gets the {TOTALS.passive} passive checks. They read what any visitor sees. The
          other {TOTALS.active} send test traffic, including real attacks. Running those on someone else&apos;s app is
          unauthorized testing. <a href="/verify">Verify your app</a> to run them.
        </p>
      </section>

      <section className="section" id="not-mine">
        <h2 className="section-head">Can I grade an app I don&apos;t own?</h2>
        <p className="section-intro">
          Yes, with the passive checks only. They read what any visitor can see. The other checks need
          proof of ownership.
        </p>
      </section>

      <section className="section" id="no-score">
        <h2 className="section-head">Why does my report have no score?</h2>
        <p className="section-intro">
          A bot challenge blocked the grade. Sloptic never tries to get past one. A partial grade would
          flatter the app. The report shows no score instead.
        </p>
      </section>

      <section className="section" id="where-leak">
        <h2 className="section-head">Why can&apos;t I see where a leak is?</h2>
        <p className="section-intro">
          For leaked secrets, exposed backends and exposed files, the location is enough to exploit it. The
          report shows it only to the app&apos;s verified owner. Owning the report does not prove you own
          the app. <a href="/verify">Verify the app</a> to see it.
        </p>
      </section>

      <section className="section" id="percentile">
        <h2 className="section-head">What does &ldquo;cleaner than&rdquo; mean?</h2>
        <p className="section-intro">
          It places your app against real hackathon apps graded the same way. A passive grade is placed
          against {PASSIVE.attrition.graded.toLocaleString("en-US")} passive grades. A full grade is placed
          against {ACTIVE.attrition.graded.toLocaleString("en-US")} full grades. These sets are frozen. New
          grades never move them. <a href="/findings">What do hackathon apps look like?</a> describes them.
        </p>
      </section>

      <section className="section" id="compare">
        <h2 className="section-head">Can I compare this grade to an older one?</h2>
        <p className="section-intro">
          Only on the same ruler. Each report names the ruler that scored it. Scores from before Sloptic
          3.0 do not compare to current ones. A passive grade and a full grade are different measurements
          too.
        </p>
      </section>

      <section className="section" id="asvs">
        <h2 className="section-head">Is Sloptic ASVS compliant?</h2>
        <p className="section-intro">
          No. Sloptic is not compliant with or certified against ASVS. Most of its security checks map to
          an ASVS requirement. Each check tests only the visible part of it.{" "}
          <a href="/methodology#asvs">Where the checks come from</a> explains.
        </p>
      </section>

      <section className="section" id="stop">
        <h2 className="section-head">How do I stop Sloptic grading my site?</h2>
        <p className="section-intro">
          Email <a href="mailto:abuse@sloptic.org">abuse@sloptic.org</a> with the site&apos;s address. We
          will block it from being graded again by anyone. No reason is needed.{" "}
          <a href="/report-issue">Report an issue</a> covers the other routes.
        </p>
      </section>
    </>
  );
}
