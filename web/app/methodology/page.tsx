import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How Sloptic grades",
  description:
    "How the grade works in plain terms: what it looks at, the two kinds of checks, what it tells you, and what it will not catch.",
};

export default function MethodologyPage() {
  return (
    <>
      <div className="page-head">
        <h1>How the grade works</h1>
        <p className="page-lead">
          In plain terms: what Sloptic looks at, how the score is built, and what it does and does not
          promise.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">It only looks from the outside</h2>
        <p className="section-intro">
          Sloptic never sees your code. It checks your app the way a visitor would, over the web, and
          only flags things that are wrong no matter what the app is for. It will not tell you whether
          your idea is good, only whether the app holds up.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Two kinds of checks</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">
              Look-only
              <span className="sub">37 checks</span>
            </span>
            <p className="desc">
              These read only what your app already shows everyone: its settings, the page, how fast it
              loads. They are safe to run on any URL, which is why the public grade uses only these.
            </p>
          </div>
          <div className="row2">
            <span className="term">
              Hands-on
              <span className="sub">54 checks</span>
            </span>
            <p className="desc">
              These actively probe for holes by sending test traffic. Doing that to a site you do not
              own would be wrong, so they run only once the owner has been verified.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">It tells you what it tested</h2>
        <p className="section-intro">
          Every grade says how much of the app it could reach. A clean score on a page it could not load
          is not the same as a clean score on one it fully checked, and it never hides the difference. A
          low score only means something next to what was actually testable.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Scores you can compare</h2>
        <p className="section-intro">
          Your number is ranked against a fixed set of real apps, so the same app earns the same place
          over time instead of drifting. A light grade and a full grade are different measurements, so
          Sloptic never mixes them on the same ranking.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What it will not catch</h2>
        <p className="section-intro">
          Sloptic checks the public, logged-out version of your app. Problems that only show up behind a
          login it cannot get past will be missed, and it says so rather than pretending it saw
          everything. It is a check on the floor every app should have, not a full security audit.
        </p>
        <div className="cta-row">
          <a className="button secondary" href="https://github.com/sloptic/sloptic-main">
            The grader, in full
          </a>
        </div>
      </section>
    </>
  );
}
