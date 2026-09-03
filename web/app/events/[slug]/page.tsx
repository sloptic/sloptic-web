import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import EventActions from "./EventActions";
import DeleteEvent from "./DeleteEvent";
import { mayOverrideEvents, isAdmin } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Event", robots: { index: false, follow: false } };

export default async function EventPage({ params }: { params: { slug: string } }) {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=/events/${params.slug}`);

  const db = supabaseAdmin();
  const [{ data: grant }, { count: claims }, { count: runs }, { data: verified }] = await Promise.all([
    db.from("grants").select("granted_at, expires_at")
      .eq("account_id", user.id).eq("kind", "organizer_event").eq("scope", params.slug)
      .is("revoked_at", null).maybeSingle(),
    db.from("event_claims").select("id", { count: "exact", head: true })
      .eq("account_id", user.id).eq("slug", params.slug).neq("status", "revoked"),
    db.from("event_runs").select("id", { count: "exact", head: true })
      .eq("account_id", user.id).eq("slug", params.slug),
    db.from("event_claims").select("window_open_at_verification")
      .eq("account_id", user.id).eq("slug", params.slug).eq("status", "verified"),
  ]);

  // An event this account has never touched is not a page. Scoped to the caller, so someone else's
  // event is a 404 here whether or not it exists, which is also the honest answer: we have nothing
  // of theirs to show you.
  if (!grant && !claims && !runs) notFound();

  // What removing it would actually take with it, counted so the warning can name numbers.
  const { data: runRows } = await db.from("event_runs").select("id")
    .eq("account_id", user.id).eq("slug", params.slug);
  const runIds = (runRows ?? []).map((r) => r.id as string);
  const { count: graded } = runIds.length
    ? await db.from("grades").select("id", { count: "exact", head: true }).in("event_run_id", runIds)
    : { count: 0 };

  const admin = isAdmin(user.email);

  // Whether the active battery may even be offered for this event. The route's own preconditions,
  // asked here only so a button that would be refused is never drawn: a live grant this account
  // holds for this slug AND a verification that happened while entrants could still read the
  // disclosure, OR operator admin, which skips both. The route and the worker check again; this
  // decides nothing.
  const canActive =
    admin ||
    (!!grant &&
      new Date(grant.expires_at) > new Date() &&
      (verified ?? []).some((c) => c.window_open_at_verification === true));

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      <div className="page-head">
        <p className="back-link"><a href="/events">Back to events</a></p>
        <h1>{params.slug}</h1>
        <p className="page-lead">
          <a href={`https://${params.slug}.devpost.com`} rel="noopener noreferrer">
            {params.slug}.devpost.com
          </a>
          {grant ? ` · verified, re-prove by ${when(grant.expires_at)}` : ""}
        </p>
      </div>

      <EventActions
        slug={params.slug}
        verified={!!grant}
        canActive={canActive}
        canOverride={admin || mayOverrideEvents(user.email)}
      />

      <DeleteEvent slug={params.slug} runs={runIds.length} graded={graded ?? 0} />
    </>
  );
}
