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
          This is not a hackathon problem, it is the state of the web.{" "}
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
          It is tempting to file all this under minor, since none of it is a break-in. That has it
          backwards. An exploit is a risk that may never be triggered. A control a screen reader cannot
          operate, or a page that takes four seconds on a phone, is not a risk at all: it is something
          that happens to every visitor, every time.{" "}
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
        <div className="rows">
          <div className="row2">
            <span className="term">It grades what you shipped</span>
            <p className="desc">
              Most tools that judge software quality read code: repositories, pull requests, diffs.
              Sloptic checks the app that is actually running, the thing your users touch, which is
              where the difference between working and holding up shows up.
            </p>
          </div>
          <div className="row2">
            <span className="term">A number, not a bug list</span>
            <p className="desc">
              A scanner hunts through one app and hands you findings. Sloptic gives you a score that
              means the same thing across completely unrelated apps, so a hundred of them can be ranked
              fairly without anyone knowing what any of them does.
            </p>
          </div>
          <div className="row2">
            <span className="term">It works on anything</span>
            <p className="desc">
              No spec, no source, no setup, no knowledge of your stack. If it answers over the web,
              Sloptic can grade it the same way it grades everything else.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">What it will not tell you</h2>
        <p className="section-intro">
          Sloptic only judges things that are wrong no matter what an app is for. Before any check is
          added, it has to survive one question: is there a legitimate app for which this behavior is
          actually correct? If yes, the check does not belong.
        </p>
        <p className="section-intro">
          So it will never tell you whether your idea is good, whether a feature is worth building, or
          whether the design works. People are better at that. Sloptic takes the part a machine can
          judge without an opinion, and leaves the rest alone.
        </p>
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
        <h2 className="section-head">Where it came from</h2>
        <p className="section-intro">
          Sloptic started as the grader for a hackathon league, built for one stubborn problem: a human
          judge cannot hold a hundred different stacks in their head and rank them fairly. It is now its
          own project, open source under Apache 2.0, for that league, for any organizer who wants a
          consistent measure across every entry, and for anyone who wants to know whether the thing they
          just shipped holds up.
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
