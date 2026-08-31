import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Sloptic",
  description:
    "Why Sloptic exists, what the name means, what makes it different from a scanner, and how it is kept honest.",
};

export default function AboutPage() {
  return (
    <>
      <div className="page-head">
        <h1>About Sloptic</h1>
        <p className="page-lead">
          Sloptic points at a running web app, checks it from the outside, and turns what it finds
          into one number. It never reads your code.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">Why it exists</h2>
        <p className="section-intro">
          Building a web app got almost free, and it shows. Apps ship looking finished but never
          hardened: no security headers, controls a screen reader cannot touch, a development build
          left running in production.
        </p>
        <p className="section-intro">
          This is not a hackathon problem, it is the state of the web.{" "}
          <a href="https://webaim.org/projects/million/" target="_blank" rel="noopener noreferrer">
            95.9% of the top million home pages
          </a>{" "}
          have detectable accessibility failures, and that number got worse last year rather than
          better. Only about{" "}
          <a
            href="https://almanac.httparchive.org/en/2025/security"
            target="_blank"
            rel="noopener noreferrer"
          >
            one site in five
          </a>{" "}
          sends a Content Security Policy at all.
        </p>
        <p className="section-intro">
          It is tempting to file this under minor, since none of it is a break-in. Yet that has it
          backwards. An exploit is a risk that may never be triggered. A control a screen reader
          cannot see, or a page that takes five seconds on a phone, is not a risk at all: it happens
          to every visitor, every time.{" "}
          <a
            href="https://www.thinkwithgoogle.com/marketing-strategies/app-and-mobile/mobile-page-speed-new-industry-benchmarks/"
            target="_blank"
            rel="noopener noreferrer"
          >
            More than half of mobile visitors
          </a>{" "}
          leave before a slow page finishes loading.
        </p>
        <p className="section-intro">
          Sloptic measured this rather than assuming it. Across more than 1,600 live hackathon apps,
          built fast with AI, a quarter carry an acute fault, something that crashes, leaks, or is
          unusable. Nearly six in ten carry a problem past the cosmetic. Only about 3% are
          exploitable. The rest is the part of the app nobody went back to, and for a team with a day
          and an AI writing the code, most of it is a couple of prompts to fix. It ships because the
          demo clicks the three buttons that work, not the dead fourth.
        </p>
        <p className="section-intro">
          These failures are known, named, and the same year after year. They go undone because
          nobody checks, which is a job for a machine.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">The name</h2>
        <div className="definition">
          <p className="definition-word">
            sloptic <span className="definition-pron">/ˈslɒp.tɪk/</span>{" "}
            <span className="definition-pos">noun</span>
          </p>
          <p className="definition-body">
            From <b>slop</b>, Merriam-Webster&apos;s word of the year for 2025, the shoddy digital
            content AI now produces in bulk, and <b>optic</b>, an instrument for bringing something
            into focus. The instrument that resolves software slop, the app that ships working but
            unhardened, into one comparable number, serenely indifferent to whatever it was meant to
            be.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">What makes it different</h2>
        <p className="section-intro">
          A scanner finds you a list of things to fix. Sloptic produces a number, so apps with
          nothing in common can go on one scale. Much the same probing, opposite purpose.
        </p>
        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                <th>most scanners</th>
                <th className="mine">Sloptic</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">what it reads</th>
                <td>source, repositories, pull requests</td>
                <td className="mine">the running app, from the outside</td>
              </tr>
              <tr>
                <th scope="row">what it needs</th>
                <td>access to the code, and setup</td>
                <td className="mine">a URL</td>
              </tr>
              <tr>
                <th scope="row">what it hands back</th>
                <td>a list of findings</td>
                <td className="mine">one score, on a fixed scale</td>
              </tr>
              <tr>
                <th scope="row">what it is for</th>
                <td>fixing one app</td>
                <td className="mine">comparing and ranking many</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">What it can and cannot judge</h2>
        <p className="section-intro">
          Sloptic only judges what is wrong no matter what an app is for. Before a check is added it
          must answer one question: is there a legitimate app for which this behavior is correct? If
          there is, the check does not belong, and a human judges that kind of thing better anyway.
        </p>
        <div className="judge-grid">
          <div className="judge" data-kind="can">
            <h3>It can judge</h3>
            <ul>
              <li>Whether a screen reader can operate the controls</li>
              <li>Whether the page loads fast enough on a phone</li>
              <li>Whether the defenses a browser expects are set</li>
              <li>Whether a secret is sitting in the code you ship</li>
              <li>Whether links resolve and pages fail honestly</li>
              <li>Whether what is live is a finished build</li>
            </ul>
          </div>
          <div className="judge" data-kind="cannot">
            <h3>It cannot judge</h3>
            <ul>
              <li>Whether the idea is any good</li>
              <li>Whether a feature does what it claims</li>
              <li>Whether the design works for anyone</li>
              <li>How hard the thing was to build</li>
              <li>Whether the code behind it is any good</li>
              <li>Whether the app is worth using at all</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">How it is kept honest</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">Findings need proof</span>
            <p className="desc">
              A finding rests on something only that fault could produce, never on something that
              looks suspicious.
            </p>
          </div>
          <div className="row2">
            <span className="term">It admits what it could not test</span>
            <p className="desc">
              A check that cannot run says so and says why, because a clean result that was never
              tested is a missed problem wearing a pass.
            </p>
          </div>
          <div className="row2">
            <span className="term">It never claims you are safe</span>
            <p className="desc">
              A 0 means nothing was found, not that nothing is there. Treat the score as a minimum.
            </p>
          </div>
          <div className="row2">
            <span className="term">It is checked against known answers</span>
            <p className="desc">
              Checks are tested against apps that are deliberately broken and deliberately clean, so
              one that cannot tell them apart does not ship.
            </p>
          </div>
          <div className="row2">
            <span className="term">It plays fair</span>
            <p className="desc">
              Sloptic respects the defenses a site puts up. Defeating bot protection is out of scope,
              permanently.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">Who made it</h2>
        <p className="section-intro">
          Sloptic was built and calibrated by{" "}
          <a href="https://www.linkedin.com/in/iansun20" target="_blank" rel="noopener noreferrer">
            Ian Sun
          </a>
          . He finished a computer science degree at Boston University in May 2026 and starts a
          cybersecurity master&apos;s there this fall. He holds the PNPT, has spoken at SecureWorld,
          Layer 8 and the NICE Conference, and hosted sessions at RSAC 2026.
        </p>
        <p className="section-intro">
          It started as the objective scoring axis for a hackathon league, built for one stubborn
          problem: a human judge cannot hold a hundred different stacks in their head and rank them
          fairly. It became its own project once grading turned out to be harder than the league
          needed. It is open source under Apache 2.0, installable with pip install sloptic.
        </p>
        <p className="section-intro">
          One person can fool themselves, so correctness is not checked only against the reference
          apps in the repo, which the same person wrote. It is also checked against targets whose
          answers nobody here controls:{" "}
          <a href="https://gapbench.vibe-eval.com/" target="_blank" rel="noopener noreferrer">
            GapBench
          </a>{" "}
          and the intentionally vulnerable apps the industry already uses, DVWA, Juice Shop, VAmPI
          and bWAPP.
        </p>
        <p className="section-intro">
          The recall audit, measuring what Sloptic misses rather than what it gets wrong, is still
          running. Until it finishes, no recall number is claimed.
        </p>
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
          <a className="button secondary" href="https://github.com/sloptic/sloptic-main">
            The grader, in full
          </a>
        </div>
      </section>
    </>
  );
}
