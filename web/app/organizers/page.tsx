import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sloptic for organizers",
  description:
    "Grade and rank every hackathon submission on the same scale, the same way for every team, whatever they built with.",
};

export default function OrganizersPage() {
  return (
    <>
      <div className="page-head">
        <h1>Sloptic for hackathon organizers</h1>
        <p className="page-lead">
          Judging by hand means holding a hundred different apps in your head. Sloptic grades every
          submission the same way and puts them on one scale, so how well each app holds up becomes a
          number you can rank.
        </p>
      </div>

      <section className="section" id="what-you-get">
        <h2 className="section-head">What you get</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">One fair scale</span>
            <p className="desc">
              Every entry graded the same way, whatever it was built with, so you can actually compare
              them instead of comparing apples to oranges.
            </p>
          </div>
          <div className="row2">
            <span className="term">A ranked leaderboard</span>
            <p className="desc">
              Submissions sorted by score, with a breakdown by area and a short report for each team.
            </p>
          </div>
          <div className="row2">
            <span className="term">Honest results</span>
            <p className="desc">
              Each grade shows how much of the app could be tested, so a clean score means clean, not
              skipped.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="limits">
        <h2 className="section-head">What it cannot judge, and why you still need judges</h2>
        <p className="section-intro">
          Sloptic grades the floor: the things that are wrong in any app, whatever it was built to do.
          Everything that depends on what a team was trying to build sits outside it on purpose, because
          a machine has no way to know what the right answer was supposed to be.
        </p>
        <div className="rows">
          <div className="row2">
            <span className="term">Whether the idea is any good</span>
            <p className="desc">
              Originality, ambition, usefulness, taste. Sloptic cannot tell a genuinely new idea from a
              template with the colors changed, and it never tries.
            </p>
          </div>
          <div className="row2">
            <span className="term">Whether it does what it claims</span>
            <p className="desc">
              Correct behavior depends on the spec, and Sloptic has none. A feature that works and a
              feature that quietly does the wrong thing look identical from the outside.
            </p>
          </div>
          <div className="row2">
            <span className="term">How hard it was to build</span>
            <p className="desc">
              A weekend of real engineering and an afternoon of gluing APIs together are the same to it.
              Effort and difficulty are yours to weigh.
            </p>
          </div>
          <div className="row2">
            <span className="term">Simpler apps have less to get wrong</span>
            <p className="desc">
              This one matters most for ranking. A static page barely exposes anything, so it can score
              better than an ambitious app that actually shipped features. The ranking does break ties in
              favor of the app that had more to defend and defended it, but a simpler project with a
              genuinely lower score still finishes ahead.
            </p>
          </div>
        </div>
        <p className="section-intro" style={{ marginTop: "1.75rem" }}>
          So use it for the part it can measure. Sloptic works best as one line in your rubric, the
          quality and durability portion, next to human judges scoring originality, usefulness, and how
          well the team executed what they set out to build. A leaderboard sorted by slop score alone
          would crown whoever built the least.
        </p>
      </section>

      <section className="section" id="how">
        <h2 className="section-head">How it works</h2>
        <p className="section-intro">
          Setup is quick, and Sloptic only grades apps that are actually in your event.
        </p>
        <div className="rows">
          <div className="row2">
            <span className="term">Register your event</span>
            <p className="desc">
              Point Sloptic at your public Devpost event and prove you run it. That ties the event to
              your account, so no one else can grade it.
            </p>
          </div>
          <div className="row2">
            <span className="term">Pick how deep to go</span>
            <p className="desc">
              A light grade needs nothing from teams and runs on every entry. A full grade adds the
              deeper checks and asks each team to add a small verification file when they submit.
            </p>
          </div>
          <div className="row2">
            <span className="term">Grade everyone</span>
            <p className="desc">
              Sloptic confirms each submitted app really belongs to your event, then grades and ranks
              the entries.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="fair">
        <h2 className="section-head">Fair by construction</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">Everyone measured the same</span>
            <p className="desc">
              An event runs at one setting, so no entry is judged more gently than another.
            </p>
          </div>
          <div className="row2">
            <span className="term">Only with permission</span>
            <p className="desc">
              The deeper checks only ever run on apps whose team has verified them, and any team can opt
              out.
            </p>
          </div>
        </div>
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
