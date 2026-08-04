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
          Sloptic points at a running web app, checks it from the outside, and turns what it finds into
          one number you can compare against other apps. It never reads your code.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">Why it exists</h2>
        <p className="section-intro">
          Building a web app got almost free, and it shows. Apps ship that look finished but were never
          hardened: no security headers, controls a screen reader cannot touch, a development build left
          running in production.
        </p>
        <p className="section-intro">
          This is not a hackathon problem; it is the state of the web.{" "}
          <a href="https://webaim.org/projects/million/" target="_blank" rel="noopener noreferrer">
            95.9% of the top million home pages
          </a>{" "}
          have detectable accessibility failures, and that number got worse last year rather than
          better. The same six mistakes have led that list for seven years running. Only about{" "}
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
          It is tempting to file all this under minor, since none of it is a break-in. But that has it
          backwards. An exploit is a risk that may never be triggered, but a control a screen reader cannot
          see, or a page that takes five seconds to load on a phone, is not a risk at all. It is something
          that happens to every visitor, every time, and affects everyone. For example, {" "}
          <a
            href="https://www.thinkwithgoogle.com/marketing-strategies/app-and-mobile/mobile-page-speed-new-industry-benchmarks/"
            target="_blank"
            rel="noopener noreferrer"
          >
            more than half of mobile visitors
          </a>{" "}
          leave before a slow page finishes loading.
        </p>
        <p className="section-intro">
          These failures are known, named, and the same year after year. They go undone at scale because
          nobody is checking, which is a job worth handing to a machine.
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
            From <b>slop</b>, Merriam-Webster&apos;s word of the year for 2025, the low-quality digital
            content that AI now produces in bulk, and <b>optic</b>, an instrument for bringing
            something into focus.
            The instrument that resolves software slop, the app that ships working but unhardened, into
            a single comparable number, serenely indifferent to whatever it was meant to be.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">What makes it different</h2>
        <p className="section-intro">
          A scanner exists to find you a list of things to fix. Sloptic exists to produce a number, so
          that apps with nothing in common can be put on one scale and ranked against each other. Much
          the same probing, opposite purpose.
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
        <p className="section-intro" style={{ marginTop: "1.5rem" }}>
          That last row is the whole difference. A list of findings tells you about one app and says
          nothing about how it stands against any other. A number that means the same thing everywhere
          is what lets a hundred unrelated apps be ordered at all.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What it can and cannot judge</h2>
        <p className="section-intro">
          Sloptic only judges things that are wrong no matter what an app is for. Before any check is
          added, we must ask: is there a legitimate app for which this behavior is actually correct? If
          yes, the check does not belong. And humans are better for judging that kind of correctness
          anyway.
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
              A problem is only reported when the app produces something that only that problem could
              produce. Sloptic will not flag something because it looks suspicious.
            </p>
          </div>
          <div className="row2">
            <span className="term">It admits what it could not test</span>
            <p className="desc">
              When a check cannot run, it says so and says why, rather than quietly passing. A clean
              result that was never actually tested is a missed problem wearing a pass, and that is the
              failure worth caring about most.
            </p>
          </div>
          <div className="row2">
            <span className="term">It never claims you are safe</span>
            <p className="desc">
              A score of 0 means nothing was found. It does not mean nothing is there. Sloptic reports
              what it saw and refuses to turn that into a promise it cannot keep.
            </p>
          </div>
          <div className="row2">
            <span className="term">It is checked against known answers</span>
            <p className="desc">
              The checks are tested against apps that are deliberately broken and apps that are
              deliberately clean, so a check that cannot tell the difference does not ship.
            </p>
          </div>
          <div className="row2">
            <span className="term">It plays fair</span>
            <p className="desc">
              Sloptic respects the defenses a site puts up. Working around bot protection or hiding what
              it is doing is out of scope, permanently.
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
          Sloptic started as the objective scoring axis for a hackathon league, built for one stubborn
          problem: a human judge cannot hold a hundred different stacks in their head and rank them
          fairly. It became its own project once the grading problem turned out to be harder than the
          league needed, and is open source under Apache 2.0.
        </p>
        <p className="section-intro">
          This is a single author project, and one person can fool themselves. So correctness is not
          checked only against the reference apps in the repo, which the same person wrote. It is also
          checked against targets whose answers nobody here controls: GapBench, a third-party recall
          benchmark, and the deliberately broken apps the industry already uses for this, DVWA, Juice
          Shop, VAmPI and bWAPP.
        </p>
        <p className="section-intro">
          The recall audit across the full catalog, measuring what Sloptic misses rather than what it
          gets wrong, is still running. Until it finishes, no recall number is claimed. Saying so is
          less satisfying than a figure, and more honest than one that has not been earned.
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
