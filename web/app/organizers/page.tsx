import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sloptic for organizers",
  description:
    "Grade and rank every submission in a hackathon on one objective yardstick, the same way for every stack.",
};

export default function OrganizersPage() {
  return (
    <>
      <div className="page-head">
        <h1>Sloptic for hackathon organizers</h1>
        <p className="page-lead">
          A human judge cannot hold a hundred stacks in their head. Sloptic grades every submission the
          same way and places each on one curve, so whether an app holds up becomes a number you can
          rank.
        </p>
      </div>

      <section className="section" id="what-you-get">
        <h2 className="section-head">What you get</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">One yardstick</span>
            <p className="desc">
              Every entry graded on the same three axes, whatever it was built with. The measure is
              objective and identical across stacks, so entries are actually comparable.
            </p>
          </div>
          <div className="row2">
            <span className="term">A leaderboard</span>
            <p className="desc">
              Submissions ranked against each other on the slop score, with the per-axis breakdown and a
              report card for every team.
            </p>
          </div>
          <div className="row2">
            <span className="term">Coverage you can trust</span>
            <p className="desc">
              Each grade ships with what was tested, so a clean score is legible as clean rather than an
              unreachable surface left unmeasured.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <h2 className="section-head">How it works</h2>
        <p className="section-intro">
          Registration is bound to your event, and grading is scoped to its entries. Nothing is graded
          on the strength of a pasted link alone.
        </p>
        <div className="rows">
          <div className="row2">
            <span className="term">Register the event</span>
            <p className="desc">
              Point Sloptic at your public Devpost event and prove you organize it by placing a token
              only an event admin can edit. That binds the event to your account.
            </p>
          </div>
          <div className="row2">
            <span className="term">Choose the tier</span>
            <p className="desc">
              A passive grade needs nothing from teams and runs on every entry. A full grade adds the
              active probes and asks each team to serve a verification token as part of submission.
            </p>
          </div>
          <div className="row2">
            <span className="term">Grade the field</span>
            <p className="desc">
              Sloptic checks each submitted URL against your event&apos;s public gallery, then grades
              and ranks the entries that belong to it.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="fair">
        <h2 className="section-head">Fair by construction</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">One event, one tier</span>
            <p className="desc">
              Every app in an event is measured identically. A passive grade and a full grade are
              different measurements and are never mixed on the same board.
            </p>
          </div>
          <div className="row2">
            <span className="term">Ownership, always</span>
            <p className="desc">
              Active grading only ever touches apps whose submission is verified, inside an event run by
              an accountable, verified organizer. Teams can opt out.
            </p>
          </div>
        </div>
        <div className="cta-row">
          <a className="button" href="mailto:hello@sloptic.org?subject=Organizer%20access">
            Request organizer access
          </a>
          <a className="button secondary" href="/methodology">
            Read the methodology
          </a>
        </div>
      </section>
    </>
  );
}
