import type { Metadata } from "next";
import EventForm from "./EventForm";

export const metadata: Metadata = {
  title: "Sloptic for organizers",
  description:
    "Grade the web app entries in your hackathon on one objective scale, and give the cleanest build a prize of its own.",
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

      <section className="section" id="what-you-get">
        <h2 className="section-head">What you get</h2>
        <div className="card-grid">
          <div className="card">
            <h3>One fair scale</h3>
            <p>
              Every web app entry graded the same way regardless of stack, so you can compare
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
            <h3>Honest results</h3>
            <p>
              Each grade shows how much of the app could be tested, so a clean score means clean, not
              skipped.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="why-sloptic">
        <h2 className="section-head">Why Sloptic</h2>
        <p className="section-intro">
          AI has made building web apps easier than ever. Yet in a 3-5 minute demo, a judge can only see the 
          surface of the app, something AI can produce trivially, which leaves barely any time for durability testing.
          Sloptic handles the durability testing, concerning the things that are wrong in any app, so judges
          can focus on the idea, the pitch, and the demo. This way, durability is an axis worth rewarding teams for, on top of pitch quality.
        </p>
      </section>

      <section className="section" id="limits">
        <h2 className="section-head">What it cannot judge</h2>
        <p className="section-intro">
          Yet Sloptic cannot grade everything. 
        </p>
        <div className="judge" data-kind="cannot">
          <h3>Still yours to judge</h3>
          <ul>
            <li>Whether the idea is original, useful, or any good</li>
            <li>Whether a feature does what the team says it does</li>
            <li>How hard the thing was to build</li>
          </ul>
        </div>
      </section>

      <section className="section" id="prize">
        <h2 className="section-head">Give it a prize of its own</h2>
        <p className="section-intro">
          Sloptic needs a running web app to look at. Other projects, such as a hardware build, a trained model, a notebook, or
          a mobile app, are not supported. If your event only accepts web apps, you can rank it outright. If not, Sloptic
          fits better as a category prize than as an overall ranking.
        </p>
        <div className="callout" data-tone="award">
          <p className="callout-label">suggested category</p>
          <p className="award-name">Slopless Builder</p>
          <p>
            To the web app entry with the lowest slop score, hence the name "slopless."
          </p>
        </div>
      </section>

      <section className="section" id="how">
        <h2 className="section-head">How it works</h2>
        <ol className="flowchart">
          <li className="flow-box">
            <span className="n">01</span>
            <p>
              Point Sloptic at your public Devpost event and prove you run it, which ties the event to
              your account so nobody else can grade it.
            </p>
          </li>
          <li className="flow-conn" aria-hidden />
          <li className="flow-box">
            <span className="n">02</span>
            <p>
              Pick how deep to go. A light grade reads what every visitor can see. A full grade adds
              the checks that send real traffic, which your event rules disclose to entrants.
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
        <h2 className="section-head">Fair by construction</h2>
        <p className="section-intro">
          Sloptic runs identically on every app, meaning the only difference is the app itself. Sloptic
          shows that the stuff no app should get wrong can be graded objectively.
        </p>
        <div className="cta-row">
          <a className="button" href="mailto:hello@sloptic.org?subject=Organizer%20access">
            Request organizer access
          </a>
          <a className="button secondary" href="/methodology">
            How the grade works
          </a>
        </div>
      </section>
    </>
  );
}
