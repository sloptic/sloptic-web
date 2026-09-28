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
      
      <section className="section" id="scope">
        <h2 className="section-head">What can Sloptic even grade?</h2>
        <p className="section-intro">
          Sloptic supports <b>web app grading</b> that is hosted on a live domain. It cannot grade
          mobile apps, Jupyter/Colab notebooks, games, or other projects that are not web apps. That being said,
          web apps are the easiest to build, easier still with AI, and so Sloptic focuses its grading there. {" "}
        </p>
      </section>
      
      <section className="section" id="fast-but-bad">
        <h2 className="section-head">How is my score bad when my app is fast?</h2>
        <p className="section-intro">
          Some kinds of slop are easy to miss when you build and test an app yourself. Below are the
          most common ones and how Sloptic checks them:
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
                  <dt>why it matters</dt>
                  <dd>{r.matters}</dd>
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
          down, and CPU work taking {LH.cpuSlowdown} times as long. This is Lighthouse&apos;s standard mobile test, slower
          than most laptops on wifi.
        </p>
        <p className="section-intro">
          Regarding accessibility, {fmt(fireRate("qa-a11y-001") ?? 0)}% of apps had an accessibility problem.
          The most common one was low contrast text, in 4 in 5 of those apps.
        </p>
      </section>

      <section className="section" id="secure">
        <h2 className="section-head">Does a low score mean my app is good for sure?</h2>
        <p className="section-intro">
          No. A 0 means Sloptic can't find anything. This could be due to limitations on what Sloptic
          can check. If you graded passively, Sloptic didn't send any attack traffic. So treat
          the score as a minimum.
        </p>
      </section>

      {/* Moved from /methodology's "It has to be proven", when that point left the definition. */}
      <section className="section" id="trust">
        <h2 className="section-head">Can I trust Sloptic&apos;s scores as is?</h2>
        <p className="section-intro">
          It is meant to be. Traditional{" "}
          <a
            href="https://en.wikipedia.org/wiki/Dynamic_application_security_testing"
            target="_blank"
            rel="noopener noreferrer"
          >
            DAST
          </a>{" "}
          tools can raise false alarms, of which a person can then dismiss them with in a few
          minutes. Sloptic, meanwhile, does not have a human in the loop, because a human would add
          subjective judgment to the score which affects comparisons.
        </p>
        {/* Moved from /methodology's "How we validate our checks". */}
        <p className="section-intro">
          As a result, findings from Sloptic must be trustworthy and precise. 
          So we calibrate Sloptic against references with known answers, such as:
        </p>
        <ul className="stat-list">
          <li>
            <span className="k">a matched pair</span>
            <span className="v">
              One reference app intentionally broken, one clean. A check that can't tell these apart does not get added.
            </span>
          </li>
          <li>
            <span className="k">apps broken on purpose</span>
            <span className="v">
              DVWA, Juice Shop, VAmPI and bWAPP, the deliberately vulnerable apps the industry already
              uses with documented faults.
            </span>
          </li>
          <li>
            <span className="k">a benchmark</span>
            <span className="v">
              {" "}<a href="https://gapbench.vibe-eval.com/" target="_blank" rel="noopener noreferrer">GapBench</a>, 
              a recall benchmark with an answer key for testing security scanners. 
            </span>
          </li>
          <li>
            <span className="k">a population</span>
            <span className="v">
              More than 1,600 real deployed apps, which shows how often a fault occurs but not
              whether one actually exists or not.
            </span>
          </li>
        </ul>
        <p className="section-intro">
          Precision is still audited only in places, and we are continuing to improve Sloptic's precision
          over the years.
        </p>
      </section>

      <section className="section" id="some-checks">
        <h2 className="section-head">Why did only some checks run?</h2>
        <p className="section-intro">
          An unverified app gets the {TOTALS.passive} passive checks that see what visitors see. The
          other {TOTALS.active} send test traffic, including attacks. Because running those on 
          others&apos; apps is considered unauthorized testing, you need to <a href="/verify">verify you own the app</a> to run them.
        </p>
      </section>

      <section className="section" id="not-mine">
        <h2 className="section-head">Can I grade an app I don&apos;t own?</h2>
        <p className="section-intro">
          Yes, but only passively. Grading actively requires proof of ownership.
        </p>
      </section>

      <section className="section" id="no-score">
        <h2 className="section-head">Why didn't I get a score?</h2>
        <p className="section-intro">
          There are many reasons why this can happen. Your app may not be reachable, or Sloptic was bot challenged,
          or it took too long to grade your app and Sloptic timed out. 
          If you think your app should have been graded, please <a href="/report-issue">report an issue</a>.
        </p>
      </section>

      <section className="section" id="where-leak">
        <h2 className="section-head">Why can&apos;t I see where a leak is?</h2>
        <p className="section-intro">
          For leaked secrets and exposed files or backends, the location is enough for attackers to exploit it. 
          To mitigate this risk, we only show the location to the app&apos;s owner.{" "}
          <a href="/verify">Verify the app</a> to see it. 
          Likewise, if we did find a leak, please patch it and rotate your secrets as soon as possible!
        </p>
      </section>

      <section className="section" id="percentile">
        <h2 className="section-head">What does &ldquo;cleaner than&rdquo; mean?</h2>
        <p className="section-intro">
          It means your app was cleaner against a set of hackathon apps graded for ranking purposes. 
          Learn more about them <a href="/findings">here</a>.
        </p>
      </section>

      <section className="section" id="compare">
        <h2 className="section-head">Can I compare this grade to an older one?</h2>
        <p className="section-intro">
          Only on the same ruler. Scores from before Sloptic
          3.0 do not compare to current ones. Likewise, a passive grade and a full grade are different measurements as well.
        </p>
      </section>

      <section className="section" id="asvs">
        <h2 className="section-head">Is Sloptic ASVS compliant?</h2>
        <p className="section-intro">
          No. Sloptic is not compliant with or certified against ASVS, but most of its security checks do
          line up with a requirement.{" "}
          <a href="/methodology#asvs">Click here to learn more</a>.
        </p>
      </section>

      <section className="section" id="stop">
        <h2 className="section-head">How do I stop Sloptic grading my app?</h2>
        <p className="section-intro">
          Email <a href="mailto:abuse@sloptic.org">abuse@sloptic.org</a> with the app&apos;s address. We
          will block it from being graded again by anyone. No reason is needed.{" "}
        </p>
      </section>

      <section className="section" id="more">
        <h2 className="section-head">My question isn't listed!</h2>
        <p className="section-intro">
          Email{" "}<a href="mailto:hello@sloptic.org">hello@sloptic.org</a> with your question and we will
          get back to you as soon as possible. If it is a common question, we will add it to this page.
        </p>
      </section>
    </>
  );
}
