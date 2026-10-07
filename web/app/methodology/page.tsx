import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { PROBE_FACTS, RATIONALE_URL, SCORING, TOTALS } from "@/lib/checks";
import { ASVS_HOME, asvsCounts } from "@/lib/asvs";

export const metadata: Metadata = pageMeta(
  "How Sloptic finds slop",
  "Sloptic checks what any visitor sees and grades on what is wrong no matter what the app is for. This page covers how it does that.",
  "/methodology",
);

// The figures on the scoring tiles are read from the grader's own catalog and constants, so they stay
// true when the catalog moves.
const DECAY = SCORING.categoryDecay;
const PRICED = PROBE_FACTS.flatMap((f) =>
  f.pricing.kind === "fixed" ? [f.pricing.points] : f.pricing.kind === "ladder" ? [f.pricing.from, f.pricing.to] : [],
).filter((n) => n > 0);
const PRICE_SPAN = `${Math.min(...PRICED)} to ${Math.max(...PRICED)}`;
const ASVS_N = asvsCounts();

export default function MethodologyPage() {
  return (
    <>
      <div className="page-head">
        <h1>How does Sloptic find slop?</h1>
        <p className="page-lead">
          Short answer: by checking your app for problems that no app should ever have. Long answer:
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">What counts as slop?</h2>
        <p className="section-intro">
          Sloptic defines &quot;slop&quot; as <em>issues that no app should ever have no matter what</em>.
          Some apps may exhibit behavior that is wrong for this app but may be correct for 
          another app, or a different use case. For example, a table any visitor can read can be right for a marketplace's
          product listing but wrong for a user database. Allowing duplicates may be correct for logs but incorrect for payment transactions. 
        </p>
        <p className="section-intro">
          But certain behaviors, like exposed secrets, injections, unhandled server errors, or pathologically slow
          apps, are wrong for <em>any app you come across</em>. No app on earth exists where such behaviors are
          &quot;correct&quot;. Thus these are considered slop and Sloptic docks apps for them.
        </p>
        <p className="section-intro">
          You might disagree with this definition of slop, but Sloptic operates this way so it can compare
          two apps against each other, which depends on an issue being an issue in every app. Without this 
          criterion, we run into the oracle problem, which states that there is no way to determine correct
          behavior without knowing what &quot;correct&quot; means.
        </p>
      </section>

      {/* The builder's seat (3.0 handoff), linked from the performance and accessibility lines on
          every report. It explains why a team misses slop and does not redefine it, so it sits after
          the definition. The rails from the handoff hold here too: Lighthouse SIMULATES the phone on
          the grading box, never "tested on a phone", and the phone framing is for performance only. */}

      {/* Every number in this section is read from the pinned grader (lib/checks.generated.ts), so the
          examples cannot drift from the prices on /checks. */}
      <section className="section" id="scoring">
        <h2 className="section-head">How Sloptic scores</h2>
        {/* Tiles, one per rule: a figure where the rule has a number (read from the grader), the
            rule's name, and what it means. */}
        <ul className="score-tiles">
          <li className="score-tile">
            <div className="score-top">
              <span className="score-fig">0</span>
              <span className="score-cap">the cleanest score</span>
            </div>
            <h3>deduction only</h3>
            <p>Nothing is earned for passing but you get penalized for failing, similar to how quality and security
              failures work in the real world. A lower score is better.</p>
          </li>
          <li className="score-tile">
            <div className="score-top">
              <span className="score-fig">likelihood × impact</span>
              <span className="score-cap">expected harm</span>
            </div>
            <h3>risk priced</h3>
            <p>Sloptic penalizes slop based on expected harm, or how often it hurts * how bad it is
              (i.e. the classical risk formula).</p>
          </li>
          <li className="score-tile">
            <div className="score-top">
              <span className="score-fig">{PRICE_SPAN}</span>
              <span className="score-cap">points per check</span>
            </div>
            <h3>varies based on check</h3>
            <p>Some checks are tiered, meaning they have a penalty range and escalate whenever worse issues are found
              in that category, while others apply a fixed penalty. 
              Lighthouse performance is penalized to the tune of {" "}{Math.round(SCORING.lighthouse.greenFloor * 100)} - N 
              (with N being the Lighthouse score).</p>
          </li>
          <li className="score-tile">
            <div className="score-top">
              <span className="decay-bars" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{ width: `${DECAY ** i * 100}%` }}>
                    {Math.round(DECAY ** i * 100)}%
                  </span>
                ))}
              </span>
              <span className="score-cap">each repeat of a kind</span>
            </div>
            <h3>damped</h3>
            <p>Repeats count less after the first instance, so your app is not penalized repeatedly for the same issue (double jeopardy).</p>
          </li>
          <li className="score-tile">
            <div className="score-top">
              <span className="score-fig">no cap</span>
              <span className="score-cap">four subtotals summed</span>
            </div>
            <h3>unbounded</h3>
            <p>Security, quality, accessibility and performance each report their own subtotal and the
              four sum to the score. There are no limits on how high the score can be.</p>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">Where do scores come from?</h2>
        <p className="section-intro">
          A penalty is not a matter of taste. Every number traces to a published authority, and where
          a finding lands inside that authority&apos;s range is set by what the check saw. You can find the 
          full rationale{" "}
          <a
            href={RATIONALE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            here
          </a>
          . Sloptic derives its scores from four authorities:
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
              for how much an issue hurts a user.
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
              , where Sloptic penalizes the distance below Lighthouse&apos;s standard for &quot;good&quot;.
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
        {/* ASVS citations: a check MAPS TO a requirement, it tests the part a visitor can see. Never
            "compliant", "certified" or "verified": ASVS assumes a verifier with source and docs. The
            mapping and its caveats live in lib/asvs.ts. #asvs is linked from the FAQ. */}
        <p className="section-intro" id="asvs">
          Additionally, Sloptic's security checks map to a requirement in the{" "}
          <a href={ASVS_HOME} target="_blank" rel="noopener noreferrer">
            OWASP Application Security Verification Standard
          </a>{" "}
          (ASVS) 5.0. {ASVS_N.maps} of the {ASVS_N.security} security checks map to a requirement while {" "}
          {ASVS_N.near} more are close to one. <a href="/checks#security">See here</a> for the full mapping.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Two kinds of checks for slop</h2>
        <div className="kind-cards">
          <div className="kind-card" data-kind="passive">
            <span className="score-fig">{TOTALS.passive}</span>
            <span className="score-cap">checks, on any app</span>
            <p>
              <b>Passive</b> checks read what your app already shows your visitors.
            </p>
          </div>
          <div className="kind-card" data-kind="active">
            <span className="score-fig">{TOTALS.active}</span>
            <span className="score-cap">checks, with ownership proof</span>
            <p>
              <b>Active</b> checks go looking for holes by sending attacks and writes to your app. 
              Doing that to a site you don't own is considered unauthorized testing, 
          so they only run when {" "}<a href="/verify">ownership is proven</a>.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
          <a className="button secondary" href="https://github.com/sloptic/sloptic-main">
            The grader repo
          </a>
        </div>
      </section>
    </>
  );
}
