import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { PROBE_FACTS, RATIONALE_URL, SCORING, categoryName, dampedTotal, type ProbeFact } from "@/lib/checks";
import { ASVS_HOME, asvsCounts } from "@/lib/asvs";

export const metadata: Metadata = pageMeta(
  "How Sloptic finds slop",
  "Sloptic checks what any visitor sees and grades on what is wrong no matter what the app is for. This page covers how it does that.",
  "/methodology",
);

// The worked examples below are computed from the grader's own prices and decay, so they stay true
// when the catalog moves. Each one names the check it reads.
const probe = (id: string): ProbeFact => {
  const f = PROBE_FACTS.find((p) => p.id === id);
  if (!f) throw new Error(`methodology example names ${id}, which is not in the catalog`);
  return f;
};
const price = (f: ProbeFact) => (f.pricing.kind === "fixed" ? f.pricing.points : NaN);
const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const DECAY = SCORING.categoryDecay;

const IDOR = probe("sec-idor-001");
const idorRung = (evidence: string) =>
  IDOR.pricing.kind === "ladder" ? IDOR.pricing.rungs.find((r) => r.evidence === evidence)?.points : undefined;
const HEADERS = ["sec-headers-002", "sec-headers-003", "sec-headers-004"].map(probe);
const HEADER_PRICES = HEADERS.map(price);
const CSP = probe("sec-headers-002");
const SQLI_GROUP = PROBE_FACTS.filter((f) => f.group === probe("sec-sqli-001").group).length;
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
          <b>1. It has to be wrong in every app.</b> Before a behavior is considered slop, it must answer a simple question:
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
          You might disagree with this definition of slop, but Sloptic operates this way so it can compare
          two apps against each other, which depends on an issue being an issue in every app. Without this 
          criterion, we run into the oracle problem, which states that there is no way to determine correct
          behavior without knowing what &quot;correct&quot; even means.
        </p>
        <p className="section-intro">
          <b>2. It has to be proven.</b> Unlike traditional{" "} 
          <a href="https://en.wikipedia.org/wiki/Dynamic_application_security_testing" target="_blank" rel="noopener noreferrer">DAST</a> tools, 
          where a false positive can be dismissed with only some wasted time, the slop Sloptic sees
          must be trustworthy by itself, since (1) the score is meant to be taken at face value, and (2) any
          human intervention affects the objective nature of Sloptic.
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
            <span className="k">lowest price first</span>
            <span className="v">
              Each check starts at the bottom of its range. Proof of worse harm raises the price. Only the
              highest proof counts. An access control flaw costs{" "}
              {IDOR.pricing.kind === "ladder" ? IDOR.pricing.from : ""} as found. Reading another
              user&apos;s record makes it {idorRung("cross_user_read")}. Changing one makes it{" "}
              {idorRung("cross_user_write")}.
            </span>
          </li>
          <li>
            <span className="k">damped</span>
            <span className="v">
              Repeats of the same kind of slop count less. The worst counts in full. The next counts{" "}
              {one(DECAY * 100)}%. The one after counts {one(DECAY ** 2 * 100)}%. A kind of slop never costs more
              than {one(1 / (1 - DECAY))} times its worst finding. Missing CSP, HSTS and clickjacking
              protection cost {one(dampedTotal(HEADER_PRICES))}. Undamped, they would cost{" "}
              {one(HEADER_PRICES.reduce((a, b) => a + b, 0))}.
            </span>
          </li>
          <li>
            <span className="k">counted once</span>
            <span className="v">
              Some checks test the same flaw in different ways. They count once, at the highest price. The{" "}
              {SQLI_GROUP} login SQL injection checks are one finding.
            </span>
          </li>
          <li>
            <span className="k">raised when it matters</span>
            <span className="v">
              Some defenses matter most during an attack. They cost little alone. A missing CSP costs{" "}
              {price(CSP)}. It costs {CSP.raised?.to} in a grade with{" "}
              {CSP.raised?.when.map(categoryName).sort().join(" or ")}.
            </span>
          </li>
          <li>
            <span className="k">measured</span>
            <span className="v">
              A few checks are priced by measurement. Lighthouse charges each point below{" "}
              {Math.round(SCORING.lighthouse.greenFloor * 100)}. Accessibility charges each barrier by its
              impact. Dead links cost more with a larger share.
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
        <p className="section-intro">
          A report shows each finding&apos;s share of the score. The shares add up to the score. Every
          check&apos;s price is on <a href="/checks#points">Sloptic&apos;s checks</a>.
        </p>
      </section>

      {/* ASVS citations: a check MAPS TO a requirement, it tests the part a visitor can see. Never
          "compliant", "certified" or "verified": ASVS assumes a verifier with source and docs. The
          mapping and its caveats live in lib/asvs.ts. */}
      <section className="section" id="asvs">
        <h2 className="section-head">Where the checks come from</h2>
        <p className="section-intro">
          Most security checks map to a requirement in the{" "}
          <a href={ASVS_HOME} target="_blank" rel="noopener noreferrer">
            OWASP Application Security Verification Standard
          </a>{" "}
          (ASVS) 5.0. {ASVS_N.maps} of the {ASVS_N.security} security checks map to a requirement.{" "}
          {ASVS_N.near} more sit close to one. <a href="/checks#security">Sloptic&apos;s checks</a> names
          each requirement.
        </p>
        <ul className="stat-list">
          <li>
            <span className="k">visible part only</span>
            <span className="v">
              A check tests what a visitor can see. An ASVS review also reads source and documentation.
            </span>
          </li>
          <li>
            <span className="k">out of reach</span>
            <span className="v">
              Business logic (V2), cryptography (V11) and most of logging (V16).
            </span>
          </li>
          <li>
            <span className="k">no checks yet</span>
            <span className="v">Tokens (V9) and OAuth (V10).</span>
          </li>
          <li>
            <span className="k">stricter than ASVS</span>
            <span className="v">
              Session tokens in local storage. ASVS allows them. The{" "}
              <a
                href="https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage"
                target="_blank"
                rel="noopener noreferrer"
              >
                OWASP HTML5 Security Cheat Sheet
              </a>{" "}
              does not.
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
            href={RATIONALE_URL}
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

      <section className="section">
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
          <a className="button secondary" href="https://github.com/sloptic/sloptic-main">
            The full grader
          </a>
        </div>
      </section>
    </>
  );
}
