import type { Metadata } from "next";
import EventForm from "./EventForm";

export const metadata: Metadata = {
  title: "Sloptic for organizers",
  description:
    "Grade the web app entries in your hackathon and give the cleanest build a prize of its own.",
};

export default function OrganizersPage({
  searchParams,
}: {
  searchParams: { event?: string };
}) {
  return (
    <>
      <div className="page-head">
        <h1>Sloptic for hackathon organizers</h1>
        <p className="page-lead">
          Judging by hand can be tedious, especially for diverse web apps. Sloptic grades the parts that no app should ever get wrong.
        </p>
        <EventForm initialEvent={searchParams.event ?? ""} />
      </div>

      <section className="section" id="why-sloptic">
        <h2 className="section-head">Why Sloptic?</h2>
        <p className="section-intro">
          AI has made building web apps easier than ever. Yet in a 3-5 minute demo, a judge can only see happy path, 
          something AI can mass produce. This leaves barely any time for quality testing, which is often
          what AI neglects outside the happy path, hence the persistence of slop.
          Sloptic handles the quality testing, concerning the things that are wrong in any app, so judges
          can focus on the idea, the pitch, and the demo. This way, quality is an axis worth rewarding 
          teams for, on top of the presentation.
        </p>
      </section>

      <section className="section" id="what-you-get">
        <h2 className="section-head">What you get</h2>
        <div className="card-grid">
          <div className="card">
            <h3>Objective grading</h3>
            <p>
              Every web app entry is graded the same way regardless of stack so you can compare
              them on something other than the demo.
            </p>
          </div>
          <div className="card">
            <h3>A ranked board</h3>
            <p>
              The gradeable entries are sorted by score, with a breakdown by area and a short report for
              each team.
            </p>
          </div>
          <div className="card">
            <h3>Calibrated results</h3>
            <p>
              Each grade shows how much of the app could be tested, so a clean score means clean, not
              skipped.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="limits">
        <h2 className="section-head">What it can't judge</h2>
        <p className="section-intro">
          Yet Sloptic cannot grade everything. Humans are still needed to judge the aspects unique
          to an app. 
        </p>
        <div className="judge" data-kind="cannot">
          <h3>Still yours to judge</h3>
          <ul>
            <li>Whether the idea is original, useful, or any good</li>
            <li>Whether a feature does what the team says it does</li>
            <li>How hard the thing was to build</li>
            <li>How well the team presents their app</li>
            <li>Judgment calls the team made</li>
          </ul>
        </div>
        <p className="section-intro">
          Additionally, Sloptic only supports <b> web app grading</b> for deployed web apps.
          Other projects, such as mobile apps, hardware projects, notebooks, AI/ML models, etc.,
          are not supported. If your hackathon accepts non-web app projects,
          it is better to use Sloptic to award a categorical prize for web apps, such as the one 
          below.
        </p>
      </section>

      <section className="section" id="prize">
        <h2 className="section-head">Suggested prize</h2>
        
        <div className="callout" data-tone="award">
          <p className="award-name">Slopless Builder</p>
          <p>
            To the web app entry with the lowest slop score, hence the name "slopless." A 
            "slopless builder" demonstrates that they can build a web app that is not only 
            demos well, but is also clean, secure, and performant.
          </p>
        </div>
      </section>

      <section className="section" id="how">
        <h2 className="section-head">How it works</h2>
        <ol className="flowchart">
          <li className="flow-box">
            <span className="n">01</span>
            <p>
              Point Sloptic at your public Devpost event and prove you run it by serving a link we provide.
            </p>
          </li>
          <li className="flow-conn" aria-hidden />
          <li className="flow-box">
            <span className="n">02</span>
            <p>
              Pick how deep to go. A passive grade reads what every visitor can see. An active grade adds
              the checks that send real traffic. Hence, the same link that verifies your event
              also discloses what Sloptic will do to your submissions.
            </p>
          </li>
          <li className="flow-conn" aria-hidden />
          <li className="flow-box">
            <span className="n">03</span>
            <p>
              Sloptic confirms each app belongs to your event, skips the entries with nothing deployed
              to look at, and grades the rest.
            </p>
          </li>
        </ol>
      </section>

      <section className="section" id="fair">
        <h2 className="section-head">Get started</h2>
        <p className="section-intro">
          Sloptic shows that the slop that no app should ever have can be scored objectively.
        </p>
        <div className="cta-row">
          <a className="button" href="#verify-event">
            Verify your event
          </a>
          <a className="button secondary" href="/methodology">
            How grading works
          </a>
        </div>
      </section>
    </>
  );
}
