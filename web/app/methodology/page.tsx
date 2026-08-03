import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sloptic methodology",
  description:
    "How the grade is made, what is passive versus active, and what Sloptic does and does not claim.",
};

export default function MethodologyPage() {
  return (
    <>
      <div className="page-head">
        <h1>Methodology</h1>
        <p className="page-lead">
          How the grade is made, and what it does and does not claim. The full account lives in the
          grader itself; this is the short version.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">Black-box and intent-independent</h2>
        <p className="section-intro">
          Sloptic reads no source and needs no spec. It grades only the intent-independent floor, the
          failures that are wrong no matter what the app is for, and never whether a feature is good. A
          leaked error, a login with no rate limiting, near-invisible text, a dev build in production:
          none of these depend on knowing what the app is meant to do.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Passive and active</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">Passive (37)</span>
            <p className="desc">
              Observe only what the app already serves every visitor: headers, TLS, the bundle,
              accessibility, performance, broken pages. Safe to run on any URL, which is why the public
              grade is passive.
            </p>
          </div>
          <div className="row2">
            <span className="term">Active (54)</span>
            <p className="desc">
              Send a payload, mutate state, or act as several identities: injection, fuzzing, uploads.
              These run only against an origin whose ownership has been verified.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">Coverage honesty</h2>
        <p className="section-intro">
          Every grade ships a coverage report: how much of the battery applied, what ran, and what could
          not be reached. A zero that means clean is distinguishable from a zero that means the surface
          could not be reached. A low score is only meaningful next to what was actually testable.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Comparable and frozen</h2>
        <p className="section-intro">
          A raw score is ranked against a frozen reference population, so the same app earns the same
          rank over time rather than drifting month to month. A passive grade is a different measurement
          from a full grade and is never placed on the full-grade curve.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Limits, stated</h2>
        <p className="section-intro">
          Sloptic grades the unauthenticated, observable surface. Defects behind a login it cannot
          establish are undercounted, and it reports that rather than implying it saw everything. It is
          an instrument for the floor every app should have, not a full penetration test.
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
