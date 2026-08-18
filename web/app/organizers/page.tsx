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
          Judging by hand means holding a hundred different projects in your head. Sloptic takes one
          part of that off you: it grades the web app entries the same way and puts them on one scale,
          so whether an app holds up becomes a number instead of a hunch.
        </p>
        <EventForm initialEvent={searchParams.event ?? ""} />
      </div>

      <section className="section" id="what-you-get">
        <h2 className="section-head">What you get</h2>
        <div className="card-grid">
          <div className="card">
            <h3>One fair scale</h3>
            <p>
              Every web app entry graded the same way, whatever it was built with, so you can compare
              them on something other than which demo went smoothest.
            </p>
          </div>
          <div className="card">
            <h3>A ranked board</h3>
            <p>
              The gradeable entries sorted by score, with a breakdown by area and a short report for
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

      <section className="section" id="limits">
        <h2 className="section-head">What it cannot judge</h2>
        <p className="section-intro">
          Sloptic grades the floor: the things that are wrong in any app, whatever it was built to do.
          Everything that depends on what a team was trying to build sits outside it, because a machine
          has no way to know what the right answer was supposed to be.
        </p>
        <div className="judge" data-kind="cannot">
          <h3>Still yours to judge</h3>
          <ul>
            <li>Whether the idea is original, useful, or any good</li>
            <li>Whether a feature does what the team says it does</li>
            <li>How hard the thing was to build</li>
          </ul>
        </div>
        <div className="callout" data-tone="warn">
          <p className="callout-label">the one that bites when ranking</p>
          <p>
            Simpler apps have less to get wrong. A static page barely exposes anything, so it can score
            better than an ambitious app that shipped features. The ranking breaks ties in
            favor of the app that had more to defend and defended it, but a simpler project with a
            lower score still wins.
          </p>
        </div>
        <p className="section-intro">
          So use it for the part it can measure: one line in your rubric, not the verdict. A board
          sorted on slop alone would crown whoever built the least.
        </p>
      </section>

      <section className="section" id="prize">
        <h2 className="section-head">Give it a prize of its own</h2>
        <p className="section-intro">
          Sloptic needs a running web app to look at. A hardware build, a trained model, a notebook, or
          a mobile app gives it nothing to grade. If your event only accepts web apps, that is your
          whole field and you can rank it outright. If it accepts anything else, which most do, Sloptic
          fits better as a category prize than as the overall ranking.
        </p>
        <div className="callout" data-tone="award">
          <p className="callout-label">suggested category</p>
          <p className="award-name">Slopless Builder</p>
          <p>
            To the web app entry with the lowest slop score. The criterion is published in advance,
            applies identically to everyone competing for it, and needs no judge in the room at
            midnight.
          </p>
        </div>
        <p className="section-intro">
          A web app is the cheapest thing at a hackathon to generate and the easiest to make look
          finished, which is what makes the one that also holds up worth naming. A category prize also
          claims only what Sloptic measures, so nobody has to accept that the cleanest build was the
          best project, and your main prizes stay with human judges.
        </p>
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
              Pick how deep to go. A light grade needs nothing from teams. A full grade adds the deeper
              checks and asks each team to add a small verification file when they submit.
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
          An event runs at one setting, so no entry is judged more gently than another. The deeper
          checks only ever run on apps whose team has verified them, and any team can opt out.
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
