import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import ClaimFlow from "./ClaimFlow";
import RunFlow from "./RunFlow";
import { mayOverrideEvents } from "@/lib/flags";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your events",
  description: "Verify a hackathon you run, and grade its entries on one scale.",
  robots: { index: false, follow: false },
};

function when(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

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
            Verify a hackathon you run and Sloptic will grade its web app entries on one scale.
          </p>
        </div>
        <section className="section attached">
          <p className="section-intro">
            Verifying ties an event to an account, so sign in first. That account is the one that can
            grade the event and publish its board, and no other account inherits it.
          </p>
          <div className="cta-row">
            <a
              className="button"
              href={`/signin?next=${encodeURIComponent(`/events?event=${prefill}`)}`}
            >
              Sign in / up
            </a>
          </div>
        </section>
      </>
    );
  }

  const { data: grants } = await supabaseAdmin()
    .from("grants")
    .select("scope, granted_at, expires_at")
    .eq("account_id", user.id)
    .eq("kind", "organizer_event")
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });

  return (
    <>
      <div className="page-head">
        <h1>Your events</h1>
        <p className="page-lead">
          Verify a hackathon you run and Sloptic will grade its web app entries on one scale.
        </p>
      </div>

      <RunFlow
        verified={(grants ?? []).map((g) => ({
          slug: g.scope,
          granted_at: g.granted_at,
          expires_at: g.expires_at,
        }))}
        canOverride={mayOverrideEvents(user.email)}
      />

      <ClaimFlow initialEvent={prefill} />
    </>
  );
}
