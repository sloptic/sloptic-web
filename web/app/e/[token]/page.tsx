import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { TOTALS } from "@/lib/checks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How your entries are graded",
  description: "What Sloptic checks, what it sends, and how to be excluded.",
};

// The participant notice, and the reason the verification token is a link rather than a string.
//
// An organizer publishes this link in their event's rules. That proves to US that they run the
// event, and it shows PARTICIPANTS what will be done to the app they submit. The consent chain the
// event tier rests on is only real if this page is SPECIFIC: "entries will be judged" is not
// agreement to having injection payloads fired at your app. So when active checks apply, this page
// says what they actually send, in the one place a participant will read it.
//
// It names the event and never the organizer: a participant needs to know what happens to their app,
// not who filed the claim.
export default async function DisclosurePage({ params }: { params: { token: string } }) {
  const { data: claim } = await supabaseAdmin()
    .from("event_claims")
    .select("slug, status, verified_at, window_open_at_verification, active_approved")
    .eq("token", params.token)
    .maybeSingle();

  // A revoked claim is a retired token: the event was deleted (or the claim withdrawn), so the link
  // published on a rules page must stop meaning anything. The delete route revokes the claim for
  // exactly this, and without the check here the disclosure kept rendering for a deleted event.
  if (!claim || claim.status === "revoked") notFound();

  const host = `${claim.slug}.devpost.com`;
  const verified = claim.status === "verified";
  // Three states, not two. NULL means we could not tell whether the window was open, and rendering
  // that as either answer would tell participants something we do not know.
  // Approval is part of the answer this page gives, not just part of the gate. What a participant is
  // owed here is what will actually happen to their app, and an event that is verified inside the
  // window still gets the passive floor until a human has approved it, so saying "the full gauntlet"
  // on the strength of the window alone would be telling them about traffic that never arrives.
  const active =
    verified && claim.window_open_at_verification === true && claim.active_approved === true;
  // NULL still means uncertain, and approval must not collapse that. We know it is passive when the
  // window was definitively closed, or when it was definitively open and nobody has approved the
  // event. An unknown window stays unknown either way, because approval says nothing about it.
  const passiveOnly =
    verified &&
    (claim.window_open_at_verification === false ||
      (claim.window_open_at_verification === true && claim.active_approved !== true));

  return (
    <>
      <div className="page-head">
        <h1>What's going on here?</h1>
        <p className="page-lead">
          The organizer of <a href={`https://${host}`} rel="noopener noreferrer">{host}</a> uses
          Sloptic to grade your project if you submitted a web app. This page explains what Sloptic
          will do to it.
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">What does Sloptic do?</h2>
        <p className="section-intro">
          Sloptic grades a running web app from the outside to check for slop. It does not see
          your source code, your repository(s), or your accounts. It examines your app like a visitor
          would and deducts points for the "slop" it finds that no app should ever have, including 
          leaked secrets, dead buttons, broken access control, and more.
        </p>
        <p className="section-intro">
          You get a slop score for the things your app got wrong, with a breakdown of each issue 
          Sloptic found. You also get a percentile showing how it fares against others.{" "}
          <a href="/findings">See what the other apps looked like</a>.
        </p>
        <p className="section-intro">
          Sloptic will <em>not</em> judge your idea, your presentation, or whether a feature is worth
          building. Those stay with the human judges.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What does Sloptic look for?</h2>
        <p className="section-intro">
          Sloptic examines your app against a catalog of{" "}
          <a href="/checks">{TOTALS.total} different checks</a>. Typically an app only gets{" "}
          {TOTALS.passive} of them, the passive ones, which send no attack traffic and change nothing.
        </p>
        {active ? (
          <>
            <p className="section-intro">
              This event was verified before submissions closed, so entries face the full gauntlet of
              tests.
            </p>
            {/* THIS page is the notice the organizer's rules point at, so what a participant was
                told is what is written here. The account and test-record sentence is not optional
                detail: several checks sign up their own users and one has account A create an object
                for account B to try to read, so a team will find data they did not make. Being
                surprised by that after the fact is the complaint this page exists to prevent. */}
            <p className="section-intro">
              Active checks send real attack traffic at your app, including injection payloads and
              malformed input. It also registers accounts and creates test records so you may see 
              stuff appear in your database(s).
            </p>
          </>
        ) : passiveOnly ? (
          <p className="section-intro">
            This event gets the passive checks and nothing else. No attack traffic is sent, nothing
            is submitted to your app, and nothing about it is changed.
          </p>
        ) : (
          <p className="section-intro">
            Which battery this event gets is settled when the organizer verifies it. Active checks
            apply only if that happened before the submission deadline, and only if we have looked
            at the event ourselves and agreed to it.
          </p>
        )}
      </section>

      <section className="section">
        <h2 className="section-head">What gets graded</h2>
        <p className="section-intro">
          The URL your team submitted, and nothing else. If your submission points at a third party
          product, a hosted notebook, a design tool, a storage bucket, it is skipped. If the
          app cannot be reached or the URL does not resolve, it is skipped too and recorded as a DNF.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Exclusions</h2>
        <p className="section-intro">
          Write to <a href="mailto:hello@sloptic.org">hello@sloptic.org</a> with your submission and we
          will exclude it. No reason is needed.
        </p>
        <p className="section-intro fineprint">
          {verified
            ? `This event was verified with Sloptic on ${new Date(claim.verified_at as string).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`
            : "This event has not completed verification with Sloptic yet."}
        </p>
        <div className="cta-row">
          <a className="button secondary" href="/methodology">
            How grading works
          </a>
          <a className="button secondary" href="/checks">
            Every check
          </a>
        </div>
      </section>
    </>
  );
}
