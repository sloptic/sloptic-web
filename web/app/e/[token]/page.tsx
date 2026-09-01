import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { TOTALS } from "@/lib/checks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How this event's entries are graded",
  description: "What Sloptic checks, what it sends, and how to opt out.",
};

// The participant notice, and the second job the verification token was always doing.
//
// An organizer publishes a link to this page in their event's rules. That link proves to US that
// they run the event, and it shows PARTICIPANTS what will be done to the app they submit. The
// consent chain the event tier rests on is only real if this page is specific: "entries will be
// judged" is not agreement to having injection payloads sent at your app, so this page says what is
// actually sent, in the place a participant will actually read it.
//
// Public on purpose, and it names only the event. Never the organizer's identity or email: a
// participant needs to know what happens to their app, not who filed the claim.
export default async function DisclosurePage({ params }: { params: { token: string } }) {
  const { data: claim } = await supabaseAdmin()
    .from("event_claims")
    .select("slug, status, verified_at")
    .eq("token", params.token)
    .maybeSingle();

  if (!claim) notFound();

  const host = `${claim.slug}.devpost.com`;
  const verified = claim.status === "verified";

  return (
    <>
      <div className="page-head">
        <h1>How this event&apos;s entries are graded</h1>
        <p className="page-lead">
          The organizer of <a href={`https://${host}`} rel="noopener noreferrer">{host}</a> uses
          Sloptic to grade the web app entries. If you are entering, this page is what that means for
          your app.
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">What Sloptic does</h2>
        <p className="section-intro">
          Sloptic grades a running web app from the outside, over the public internet. It never sees
          your source code, your repository, or your accounts. It reads your app the way a visitor
          does and scores a fixed floor every app should meet: security headers, whether a screen
          reader can operate the controls, how fast the page loads, whether links resolve and errors
          are handled. Lower is better, and it is compared against the same scale for every entry.
        </p>
        <p className="section-intro">
          It cannot judge your idea, whether a feature does what you say, how hard it was to build, or
          whether the design works. Those stay with the human judges.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Two kinds of checks, and which one runs</h2>
        <p className="section-intro">
          <b>Passive checks read only what your app already serves to anyone.</b> Loading a page,
          reading headers, running an accessibility pass on what rendered. Running them is no different
          from someone visiting your site. {TOTALS.passive} of the {TOTALS.total} checks are passive.
        </p>
        <p className="section-intro">
          <b>Active checks send real attack traffic.</b> Injection payloads, malformed input, path
          traversal attempts, and requests designed to make the app fail. Nothing is destroyed on
          purpose, but this is genuine attack traffic aimed at your app, and it may appear in your
          logs, trip your error reporting, or create test records.
        </p>
        <p className="section-intro">
          Active checks run for an event only when the organizer verified before the submission
          deadline, so this notice existed before you entered. If they verified afterwards, the
          entries get passive checks only.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Which app gets graded</h2>
        <p className="section-intro">
          The address your team published on your own submission, and nothing else. Sloptic does not
          go looking for other things you own. If your submission points at a third party product
          rather than something your team built, a hosted document, a design tool, a storage bucket,
          it is skipped: probing it would hit that company rather than you, and your team cannot agree
          to that on their behalf.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">If you would rather not</h2>
        <p className="section-intro">
          Write to <a href="mailto:hello@sloptic.org">hello@sloptic.org</a> with your submission and we
          will exclude it. You do not need to give a reason, and it does not affect your entry in the
          event, which the organizer judges as they always have.
        </p>
        <p className="section-intro fineprint">
          {verified
            ? `This event was verified with Sloptic on ${new Date(claim.verified_at as string).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`
            : "This event has not completed verification with Sloptic yet, so no entries have been graded for it."}
        </p>
        <div className="cta-row">
          <a className="button secondary" href="/methodology">
            How the grade works
          </a>
          <a className="button secondary" href="/checks">
            Every check
          </a>
        </div>
      </section>
    </>
  );
}
