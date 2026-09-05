import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/run/cancel  { id }  ->  stop the run.
//
// Queued grades become 'cancelled' (distinct from failed: nothing went wrong, the organizer
// stopped them), the entries they belonged to are unlinked so those apps are gradeable again,
// and the run is marked cancelled. Grades already RUNNING are killed by the supervisor on its next
// pass (see running_on_cancelled_runs and the kill loop in the worker's __main__): they hold
// concurrency slots a fresh run would starve behind, and a cancel is an instruction about traffic
// now, not a preference about later. This comment used to say they were allowed to finish, which
// was true before that change and is the wording the UI was once written against.
// The worker's own db.cancel_run does the same thing in one transaction; this path exists because
// the organizer's button should not have to wait for a worker poll.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { id }." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Which run?" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: run } = await db
    .from("event_runs")
    .select("id, status")
    .eq("id", body.id)
    .eq("account_id", user.id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (run.status !== "grading" && run.status !== "ready") {
    return NextResponse.json({ error: `A ${run.status} run cannot be cancelled.` }, { status: 409 });
  }

  const { data: queued } = await db
    .from("grades")
    .select("id")
    .eq("event_run_id", run.id)
    .eq("status", "queued");
  const queuedIds = (queued ?? []).map((g) => g.id);

  // Mark, unlink, and mark the run. Unlinking only entries whose grade is NOT running keeps the
  // in-flight ones attached, so their reports land on the field they were graded for.
  if (queuedIds.length > 0) {
    // The eq("status","queued") is the race guard: the claim loop is a single statement and can
    // flip a grade to running between this route's snapshot and this write. Postgres re-checks the
    // predicate at execution, so a just-claimed grade keeps running instead of being marked
    // cancelled under a child that is about to land a done report on it.
    const { data: cancelledRows, error: gErr } = await db
      .from("grades")
      .update({ status: "cancelled", finished_at: new Date().toISOString(), error: "cancelled by the organizer" })
      .in("id", queuedIds)
      .eq("status", "queued")
      .select("id");
    if (gErr) return NextResponse.json({ error: "Could not cancel the queue." }, { status: 500 });
    const cancelledIds = (cancelledRows ?? []).map((g) => g.id);
    if (cancelledIds.length > 0) {
      const { data: linked } = await db
        .from("event_entries")
        .select("id")
        .eq("run_id", run.id)
        .in("grade_id", cancelledIds);
      if (linked?.length) {
        await db.from("event_entries").update({ grade_id: null }).in(
          "id",
          linked.map((l) => l.id)
        );
      }
    }
  }
  // Booked retries die with the run, matching the worker's own cancel_run.
  await db.from("grades").update({ retry_due_at: null }).eq("event_run_id", run.id);
  const { error } = await db
    .from("event_runs")
    .update({ status: "cancelled", paused: false, finished_at: new Date().toISOString() })
    .eq("id", run.id)
    .in("status", ["ready", "grading"]);
  if (error) return NextResponse.json({ error: "Could not cancel the run." }, { status: 500 });
  return NextResponse.json({ cancelled: true, dequeued: queuedIds.length });
}
