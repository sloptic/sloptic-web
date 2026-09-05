import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import EventActions from "./EventActions";
import DeleteEvent from "./DeleteEvent";
import { mayOverrideEvents, isAdmin } from "@/lib/flags";
import { runsForAccount } from "@/lib/event-runs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Event", robots: { index: false, follow: false } };

export default async function EventPage({ params }: { params: { slug: string } }) {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=/events/${params.slug}`);

  const db = supabaseAdmin();
  const [{ data: grant }, { data: claimRows }, { data: verified }, { data: runRows }] = await Promise.all([
    db.from("grants").select("granted_at, expires_at, evidence")
      .eq("account_id", user.id).eq("kind", "organizer_event").eq("scope", params.slug)
      .is("revoked_at", null).maybeSingle(),
    db.from("event_claims").select("id, slug, token, status, check_status, check_detail, checked_at")
      .eq("account_id", user.id).eq("slug", params.slug).order("issued_at", { ascending: false }),
    db.from("event_claims").select("window_open_at_verification")
      .eq("account_id", user.id).eq("slug", params.slug).eq("status", "verified"),
    db.from("event_runs").select("id")
      .eq("account_id", user.id).eq("slug", params.slug),
  ]);

  // An event this account has never touched is not a page. Scoped to the caller, so someone else's
  // event is a 404 here whether or not it exists, which is also the honest answer: we have nothing
  // of theirs to show you.
  if (!grant && (claimRows ?? []).length === 0 && (runRows ?? []).length === 0) notFound();

  const runIds = (runRows ?? []).map((r) => r.id as string);
  // Seeding the client with the runs it would otherwise fetch after hydration: the field paints with
  // the page, and the events API's own compact shape arrives without a second auth-plus-query chain.
  const [gradedRes, seededRuns] = await Promise.all([
    runIds.length
      // Only the finished ones: the delete dialog calls these "reports" and offers to take them,
      // and what it takes are results rows. A queued grade has none.
      ? db.from("grades").select("id", { count: "exact", head: true }).in("event_run_id", runIds).eq("status", "done")
      : Promise.resolve({ count: 0 }),
    runsForAccount(user.id, params.slug).catch(() => []),
  ]);
  const claimRow = (claimRows ?? []).find((c) => c.status !== "revoked") ?? null;
  const graded = gradedRes.count ?? 0;

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
          {grant ? `, verified, re-prove by ${when(grant.expires_at)}` : ""}
        </p>
      </div>

      <EventActions
        slug={params.slug}
        verified={!!grant}
        canActive={canActive}
        canOverride={admin || mayOverrideEvents(user.email)}
        initialClaim={claimRow}
        initialRuns={seededRuns}
        grantExpiry={grant?.expires_at ?? null}
        verifiedLink={(() => {
          const ev = (grant?.evidence ?? null) as Record<string, unknown> | null;
          if (!ev || typeof ev !== "object") return null;
          const page = typeof ev.page === "string" ? ev.page : null;
          const text = typeof ev.link_text === "string" ? ev.link_text : null;
          return page || text ? { page, text } : null;
        })()}
      />

      <DeleteEvent slug={params.slug} runs={runIds.length} graded={graded ?? 0} />
    </>
  );
}
