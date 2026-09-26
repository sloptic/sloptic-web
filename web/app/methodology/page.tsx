import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { ACTIVE, fireRate, fmt } from "@/lib/corpus";
import { LIGHTHOUSE_PROFILE as LH, SEAT_ROWS } from "@/lib/seat";

export const metadata: Metadata = pageMeta(
  "How Sloptic finds slop",
  "Sloptic checks what any visitor sees and grades on what is wrong no matter what the app is for. What counts as slop, how Sloptic scores it, and what it can't say.",
  "/methodology",
);

export default function MethodologyPage() {
  return (
    <>
      <div className="page-head">
        <h1>How does Sloptic find slop?</h1>
        <p className="page-lead">
          TL;DR: by checking what any visitor sees and grading on what is wrong no matter what the app is for. 
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">What Sloptic sees</h2>
        <p className="section-intro">
          Sloptic never sees your code. It checks the app the way a visitor would over the web. This method
          works on any app you give it, which is what makes two unrelated apps comparable at all.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What counts as slop?</h2>
        <p className="section-intro">
          <b>It has to be wrong in every app.</b> Before a behavior is considered slop, it must answer a simple question:
          Is there a legitimate app for which this behavior is correct? For example, a table any visitor can
          read can be right for a product catalogue. Allowing duplicates may be correct for logs but wrong for payment transactions. These examples are cases where an app can <em>legitimately
          exhibit a particular behavior</em> and thus wouldn't be considered slop.
        </p>
        <p className="section-intro">
          However, behaviors like exposed secrets, SQL injection, an unhandled server error, or a pathologically slow
          app, are wrong for <em>any app you come across</em>. No app on earth exists where such behaviors are
          &quot;correct&quot; and thus these are considered slop and Sloptic docks them.
        </p>
        <p className="section-intro">
          <b>It has to be proven.</b> An instance of slop rests on something only that instance could
          produce, with evidence to back it up. Unlike traditional{" "} 
          <a href="https://en.wikipedia.org/wiki/Dynamic_application_security_testing" target="_blank" rel="noopener noreferrer">DAST</a> tools, 
          where a false positive can be dismissed with only some wasted time, the slop Sloptic sees
          must be trustworthy on their own, since (1) the score is meant to be taken at face value, and (2) any
          human intervention affects the objective nature of Sloptic.
        </p>
      </section>

      {/* The builder's seat (3.0 handoff), linked from the performance and accessibility lines on
          every report. It explains why a team misses slop and does not redefine it, so it sits after
          the definition. The rails from the handoff hold here too: Lighthouse SIMULATES the phone on
          the grading box, never "tested on a phone", and the phone framing is for performance only. */}
      <section className="section" id="your-seat">
        <h2 className="section-head">Why is my score bad when my app is fast?</h2>
        <p className="section-intro">
          Some kinds of slop are easy to miss when you build and test an app yourself. The table below
          shows the most common ones and how Sloptic checks for each.
        </p>
        <div className="seat-wrap">
          <table className="count-table seat-table">
            <thead>
              <tr>
                <th>slop</th>
                <th>why it&apos;s missed</th>
                <th>how Sloptic checks</th>
              </tr>
            </thead>
            <tbody>
              {SEAT_ROWS.map((r) => (
                <tr key={r.failure}>
                  <th scope="row">{r.failure}</th>
                  <td data-label="why it's missed">{r.invisible}</td>
                  <td data-label="how Sloptic checks">{r.instead}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

      <section className="section">
        <h2 className="section-head">How Sloptic scores</h2>
        <ul className="stat-list">
          <li>
            <span className="k">deduction only</span>
            <span className="v">
              Nothing is earned for passing, but you get penalized for failing. This mirrors how failures work:
              successes are quiet but failures are visible. A lower score is better.
            </span>
          </li>
          <li>
            <span className="k">risk priced</span>
            <span className="v">
              Sloptic penalizes slop based on expected harm, or how often it hurts someone multiplied by how bad it is
              (i.e. the classical risk formula).
            </span>
          </li>
          <li>
            <span className="k">damped</span>
            <span className="v">
              One kind of slop counts once. If, for example, there are 20 instances of missing headers, Sloptic 
              will not charge 20 times, but only once. This prevents a single kind of slop from dominating the score.
            </span>
          </li>
          <li>
            <span className="k">unbounded</span>
            <span className="v">
              Security, quality, accessibility and performance each report their own subtotal and the
              four sum to the score. There are no limits on how high the score can be.
            </span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">Where the scores come from</h2>
        <p className="section-intro">
          A penalty is not a matter of taste. Every number traces to a published authority, and where
          a finding lands inside that authority&apos;s range is set by what the check saw. You can find the 
          full rationale{" "}
          <a
            href="https://github.com/sloptic/sloptic-main/blob/main/docs/PENALTY_RATIONALE.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            in the open grader
          </a>
          .
        </p>
        <p className="section-intro">
          Different failures answer to different authorities, and only severity sets the
          number.
        </p>
        <ul className="stat-list">
          <li>
            <span className="k">security holes</span>
            <span className="v">
              <a href="https://www.first.org/cvss/" target="_blank" rel="noopener noreferrer">
                CVSS
              </a>
              , the industry scale for how bad a vulnerability is, reconciled against the{" "}
              <a
                href="https://github.com/bugcrowd/vulnerability-rating-taxonomy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Bugcrowd rating taxonomy
              </a>
              .
            </span>
          </li>
          <li>
            <span className="k">quality failures</span>
            <span className="v">
              <a
                href="https://iso25000.com/index.php/en/iso-25000-standards/iso-25010"
                target="_blank"
                rel="noopener noreferrer"
              >
                ISO/IEC 25010
              </a>
              , the software quality standard, crossed with{" "}
              <a
                href="https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Nielsen&apos;s severity scale
              </a>{" "}
              for how much a fault hurts a user.
            </span>
          </li>
          <li>
            <span className="k">performance</span>
            <span className="v">
              <a
                href="https://developer.chrome.com/docs/lighthouse/performance/performance-scoring"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Lighthouse
              </a>
              , charging only the distance an app falls below Lighthouse&apos;s own line for good.
            </span>
          </li>
          <li>
            <span className="k">accessibility</span>
            <span className="v">
              <a href="https://github.com/dequelabs/axe-core" target="_blank" rel="noopener noreferrer">
                axe-core
              </a>
              , priced by the impact rating it assigns each barrier against{" "}
              <a href="https://www.w3.org/TR/WCAG21/" target="_blank" rel="noopener noreferrer">
                WCAG
              </a>
              .
            </span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">Two kinds of checks for slop</h2>
        <p className="section-intro">
          <b>Passive</b> checks read what your app already shows every visitor. Running them on a
          stranger&apos;s site is no different from visiting it.
        </p>
        <p className="section-intro">
          <b>Active</b> checks go looking for holes by sending real attacks (because some instance of slop are
          security vulnerabilities). Doing that to a site you don't own is considered unauthorized testing, 
          so they only run when ownership is proven.{" "}
          <a href="/verify">Learn more about domain verification here.</a>
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">How we validate our checks</h2>
        <p className="section-intro">
          Checks are calibrated against apps with known answers because no single target
          proves much by itself.
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
              DVWA, Juice Shop, VAmPI and bWAPP, the intentionally vulnerable apps the industry already
              uses with documented faults.
            </span>
          </li>
          <li>
            <span className="k">an outside benchmark</span>
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
      </section>

      <div className="method" data-tone="limits">
        <h2>What Sloptic can't say</h2>
        <p>
          <b>It never says you are safe.</b> A 0 means nothing was found. The
          score cannot tell a defended thing from an absent one, and it cannot see everything. Hence, 
          you should treat the score as a minimum, not a maximum.
        </p>
        <p>
          <b>Precision is vouched in places.</b> The classes with precision
          rules are checked, but the rest are considered unaudited.
        </p>
        <p>
          <b>The miss rate is not measured yet.</b> The checks are validated for precision, but full recall is
          difficult due to the diversity of web apps. To compensate, Sloptic checks parity, the range of coverage across apps.
        </p>
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
          <a className="button secondary" href="https://github.com/sloptic/sloptic-main">
            The full grader
          </a>
        </div>
      </div>
    </>
  );
}
