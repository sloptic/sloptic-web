import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/delete  { slug }  ->  remove an event from this account.
//
// Order matters, because grades.event_run_id is ON DELETE SET NULL. Dropping the runs first would
// leave every graded entry orphaned but still carrying the organizer's account, so 50 apps an
// organizer never submitted would reappear under "apps you graded" and never expire.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { slug?: string; reports?: "keep" | "delete" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { slug }." }, { status: 400 });
  }
  const slug = (body.slug ?? "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "Which event?" }, { status: 400 });
  const purge = body.reports === "delete";

  const db = supabaseAdmin();
  const { data: runs } = await db
    .from("event_runs")
    .select("id")
    .eq("account_id", user.id)
    .eq("slug", slug);
  const runIds = (runs ?? []).map((r) => r.id as string);

  // 1. Let go of the grades first, while they can still be found. They become ordinary anonymous
  //    grades, which the 30 day sweep collects, the same thing that happens to a saved grade when an
  //    account is deleted. The reports stay readable at their own links until then.
  let detached = 0;
  let purged = 0;
  if (runIds.length) {
    // Booked retry passes die with the run, and they must die BEFORE the runs are deleted below.
    // ON DELETE SET NULL nulls grades.event_run_id, and claim_retry's only interlock is keyed on
    // that column, so once the run is gone there is nothing left in the predicate to stop the pass:
    // deleting an event would otherwise keep firing its attack tails at participants' apps for up
    // to half an hour, on rows that by then belong to nobody.
    await db.from("grades").update({ retry_due_at: null }).in("event_run_id", runIds);

    const { data: gradeRows } = await db
      .from("grades")
      .update({ account_id: null })
      .in("event_run_id", runIds)
      .select("id");
    detached = gradeRows?.length ?? 0;

    // 2. Optionally take the reports now instead of in thirty days. Only the REPORTS: the grades
    //    rows stay as anonymous stubs, which is what the retention sweep does too. Deleting them
    //    outright would erase the record that the grading happened, and the daily budget is counted
    //    from finished grades, so removing an event after using it would refund its own quota.
    if (purge && gradeRows?.length) {
      const { data: gone } = await db
        .from("results")
        .delete()
        .in("grade_id", gradeRows.map((g) => g.id as string))
        .select("grade_id");
      purged = gone?.length ?? 0;
    }

    // 3. Then the runs, which takes their entries with them.
    await db.from("event_runs").delete().in("id", runIds);
  }

  // 4. Revoke rather than delete: the grant is the record that this account once proved this event,
  //    and the partial unique index only counts live ones, so a later claim can still verify.
  await db
    .from("grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("account_id", user.id)
    .eq("kind", "organizer_event")
    .eq("scope", slug)
    .is("revoked_at", null);

  // 5. The claim goes the same way, which also retires its token: a link already published on a
  //    rules page stops meaning anything.
  await db
    .from("event_claims")
    .update({ status: "revoked" })
    .eq("account_id", user.id)
    .eq("slug", slug)
    .in("status", ["pending", "verified", "failed"]);

  return NextResponse.json({ deleted: true, runs: runIds.length, detached, purged });
}
