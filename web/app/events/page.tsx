import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { mayOverrideEvents } from "@/lib/flags";
import AddEvent from "./AddEvent";
import EventRows from "./EventRows";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your events",
  description: "Verify a hackathon you run, and grade its entries on one scale.",
  robots: { index: false, follow: false },
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: { event?: string };
}) {
  const user = await currentUser();
  const prefill = searchParams.event ?? "";

  if (!user) {
    return (
      <>
        <div className="page-head">
          <h1>Your events</h1>
          <p className="page-lead">
            Verify a hackathon you run and Sloptic will grade its web app entries.
          </p>
        </div>
        <section className="section attached">
          <p className="section-intro">
            Verifying ties an event to an account, so sign in first. That account is the one that can
            grade the event and publish its board.
          </p>
          <div className="cta-row">
            <a className="button" href={`/signin?next=${encodeURIComponent(`/events?event=${prefill}`)}`}>
              Sign in / up
            </a>
          </div>
        </section>
      </>
    );
  }

  const { data: grants } = await supabaseAdmin()
    .from("grants")
    .select("scope, expires_at")
    .eq("account_id", user.id)
    .eq("kind", "organizer_event")
    .is("revoked_at", null);

  return (
    <>
      <div className="page-head">
        <h1>Your events</h1>
        <p className="page-lead">
          Verify a hackathon you run and Sloptic will grade its web app entries.
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">Add an event</h2>
        <AddEvent initialEvent={prefill} />
        {mayOverrideEvents(user.email) && (
          <p className="section-intro fineprint">
            Override is on for this account: you can grade any event, passive only.
          </p>
        )}
      </section>

      <section className="section">
        <h2 className="section-head">Your events</h2>
        {/* A list, and only a list. Everything an event needs doing to it lives on its own page. */}
        <EventRows verified={(grants ?? []).map((g) => ({ slug: g.scope, expires_at: g.expires_at }))} />
      </section>
    </>
  );
}
