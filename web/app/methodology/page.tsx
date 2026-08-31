import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How Sloptic grades",
  description:
    "The method in full: what counts as a finding, how the score is built, what happens when a check cannot run, how the ruler is validated, and what is not claimed yet.",
};

export default function MethodologyPage() {
  return (
    <>
      <div className="page-head">
        <h1>How the grade works</h1>
        <p className="page-lead">
          What Sloptic looks at, what it counts as a finding, how the score is built, and what it
          does not claim
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">It only looks from the outside</h2>
        <p className="section-intro">
          Sloptic never sees your code. It checks the app the way a visitor would over the web. This method
          works on any app you give it, which is what makes two unrelated apps comparable at all.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What counts as a finding</h2>
        <p className="section-intro">
          <b>It has to be wrong in every app.</b> Before a check is added it must answer a simple question:
          Is there a legitimate app for which this behavior is correct? For example, a table any visitor can
          read can be right for a product catalogue. Allowing duplicates may be correct for logs but wrong for payment transactions. These examples are cases where an app can <em>legitimately
          exhibit a particular behavior</em> and is thus not penalized for it.
        </p>
        <p className="section-intro">
          However, behavior like exposed secrets, SQL injection, an unhandled server error, or a pathologically slow
          app, are wrong for <em>any app you come across</em>. No app on earth exists where such behaviors are
          &quot;correct&quot; and thus Sloptic checks for them.
        </p>
        <p className="section-intro">
          <b>It has to be proven.</b> A finding rests on something only that fault could
          produce, with evidence to back it up. For example, injection probes only trigger a finding when 
          a site verifiably produces a response that could only come from execution. Unlike traditional{" "} 
          <a href="https://en.wikipedia.org/wiki/Dynamic_application_security_testing" target="_blank" rel="noopener noreferrer">DAST</a> tools, 
          where a false positive can be dismissed with only some wasted time, Sloptic's findings
          must be trustworthy on their own, since (1) the score is meant to be taken at face value, and (2) any
          human intervention affects the objective nature of Sloptic.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">How the score is built</h2>
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
              A penalty is expected harm, or how often it hurts someone multiplied by how badly, rather
              than raw severity. 
            </span>
          </li>
          <li>
            <span className="k">damped</span>
            <span className="v">
              One root cause counts once. Variants of the same flaw collapse to a single finding, and
              repeats within a category decay sharply, so ten pages missing one header are not ten
              findings.
            </span>
          </li>
          <li>
            <span className="k">unbounded, not out of 100</span>
            <span className="v">
              Security, quality and performance each report their own subtotal and the three sum to the
              score.
            </span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">Where the numbers come from</h2>
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
        <p className="section-intro">
          Within a class, a check charges the lowest price by default and raises it only when it proves
          worse harm. For example, an access control flaw that leaks one record is priced well below one that hands
          over a whole table.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Two kinds of checks</h2>
        <p className="section-intro">
          <b>Passive</b> checks read what your app already shows every visitor. Running them on a
          stranger&apos;s site is no different from visiting it.
        </p>
        <p className="section-intro">
          <b>Active</b> checks go looking for holes by sending real attacks. Doing that to a
          site you do not own is considered unauthorized testing, so they run only once ownership is proven.{" "}
          <a href="/verify">What verifying involves.</a>
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">How the checks are validated</h2>
        <p className="section-intro">
          Checks are calibrated against apps with known answers because no single target
          proves much on its own.
        </p>
        <ul className="stat-list">
          <li>
            <span className="k">a matched pair</span>
            <span className="v">
              One reference app deliberately broken, one clean. A check that can't tell these apart does not get added.
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
              whether one actually exists or not, which requires hand auditing.
            </span>
          </li>
        </ul>
      </section>

      <div className="method" data-tone="limits">
        <h2>What Sloptic does not claim</h2>
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
            The grader, in full
          </a>
        </div>
      </div>
    </>
  );
}
