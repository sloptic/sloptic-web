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
          What Sloptic looks at, what it counts as a finding, how those become a number, and what it
          does not claim. The grader is open, so anything here can be checked against the code.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">It only looks from the outside</h2>
        <p className="section-intro">
          Sloptic never sees your code. It checks the app the way a visitor would, over the web, with no
          source and no description of what the app is meant to do. That constraint is the point: the
          same method works on any app, whatever it was built with, which is what makes two unrelated
          apps comparable at all.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What counts as a finding</h2>
        <p className="section-intro">
          <b>It has to be wrong in every app.</b> Before a check is added it must survive one question:
          is there a legitimate app for which this behavior is correct? A table any visitor can
          read is exactly right for a product catalogue, so the check cannot fire on an open table. It
          fires on what is in the columns. Whether <em>this</em> user should see <em>that</em> record is
          intent, and stays human. Whether a stranger can read a table containing{" "}
          <code>contact_email</code> is not.
        </p>
        <p className="section-intro">
          <b>It has to be proven, not guessed.</b> A finding rests on something only that fault could
          produce, and echoing back our own payload never counts. The file-access check does not match
          the path it asked for, it matches a line out of the password file it should never have
          received. The scripting check requires the payload to execute in the page, not merely
          appear in it. One filter check keys on a fragment of the app&apos;s own query template
          surfacing in an error, which nothing we sent could have produced.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">How the score is built</h2>
        <ul className="stat-list">
          <li>
            <span className="k">deduction only</span>
            <span className="v">
              Nothing is earned for passing. This mirrors how failure works: defending seven of
              eight injectable inputs is still a breach, so the seven add nothing and the eighth adds
              its full penalty.
            </span>
          </li>
          <li>
            <span className="k">risk priced</span>
            <span className="v">
              A penalty is expected harm, how often it hurts someone multiplied by how badly, rather
              than raw severity. Nothing else outranks a single catastrophic security fault.
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
            <span className="k">per area, not out of 100</span>
            <span className="v">
              Security, quality and performance each report their own subtotal and the three sum to the
              score. Scaling to 100 was tried and reverted: a denominator makes apps with different
              amounts of surface incomparable, which defeats the purpose.
            </span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">Two kinds of checks</h2>
        <p className="section-intro">
          <b>Look-only</b> checks read what your app already shows every visitor: its settings, the page
          it serves, how fast it loads, whether a screen reader can use it. Running them on a
          stranger&apos;s site is no different from visiting it, so they run on any URL.
        </p>
        <p className="section-intro">
          <b>Hands-on</b> checks go looking for holes by sending real attack traffic. Doing that to a
          site you do not own is unauthorized testing, so they run only once ownership is proven.{" "}
          <a href="/verify">What that involves.</a>
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What happens when a check cannot run</h2>
        <p className="section-intro">
          Every check returns one of three answers, and the third is the one that matters. It found the
          fault, it tested and did not find it, or it could not establish the conditions to test at all.
          A check with no login in front of it cannot report that the login is safe.
        </p>
        <p className="section-intro">
          That third answer is never quietly folded into a pass, because a clean result that was never tested is a missed fault wearing a pass. Each one records why it could not run. The
          same rule applies when a target is too noisy to read: an app that answers every request with
          error grammar carries no signal, so the benign case is checked first and the result is marked
          untestable rather than guessed. Every grade ships the tally, and on the population we
          measured, the median app ran 57% of the battery.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">How the checks are validated</h2>
        <p className="section-intro">
          Checks are calibrated against apps with known answers, in layers, because no single target
          proves much on its own.
        </p>
        <ul className="stat-list">
          <li>
            <span className="k">a matched pair</span>
            <span className="v">
              One reference app deliberately broken, one deliberately clean. A check that cannot tell
              them apart does not ship.
            </span>
          </li>
          <li>
            <span className="k">known-broken apps</span>
            <span className="v">
              DVWA, Juice Shop, VAmPI and bWAPP: the deliberately vulnerable apps the industry already
              uses, whose faults are documented by people with no stake here.
            </span>
          </li>
          <li>
            <span className="k">a third-party benchmark</span>
            <span className="v">
              GapBench, an outside recall benchmark with its own ground truth, run politely and without
              any attempt to defeat its protections.
            </span>
          </li>
          <li>
            <span className="k">a population</span>
            <span className="v">
              More than 1,600 real deployed apps, which shows how often a fault occurs but never
              whether a given call was right, because a corpus has no answer key.
            </span>
          </li>
        </ul>
      </section>

      <div className="method" data-tone="limits">
        <h2>What it does not claim</h2>
        <p>
          <b>It never says you are safe.</b> A 0 means nothing was found, not that nothing is there. The
          score cannot tell a defended thing from an absent one, and calling that clean would be a false
          assurance.
        </p>
        <p>
          <b>It sees the logged-out surface.</b> Faults behind a login it cannot get past are missed, and
          the coverage report says so rather than implying it saw everything.
        </p>
        <p>
          <b>Some findings belong to the platform, not the app.</b> An app on a hosting subdomain may be
          serving the platform&apos;s own login page, and a fault there is not the team&apos;s. That
          boundary is narrowed, never claimed closed, which is one reason a human stays in the loop.
        </p>
        <p>
          <b>Precision is vouched in places, not everywhere.</b> The classes with explicit precision
          rules are checked. The rest is reported as unaudited rather than dressed up as verified, and
          most of it is presence checks where getting it wrong is structurally hard.
        </p>
        <p>
          <b>The miss rate is not measured yet.</b> The audit of what Sloptic fails to catch, across the
          whole catalog, is still running. Until it finishes, no recall figure is claimed.
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
