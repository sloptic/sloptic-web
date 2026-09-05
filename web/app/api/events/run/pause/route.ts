import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/run/pause  { id, paused }  ->  hold or release a run's queue.
//
// Pausing stops the worker from CLAIMING any more of this run's grades; the ones already running
// finish, because a grade is minutes from landing and killing children buys nothing. Nothing is
// lost: release, and the queue resumes exactly where it stopped.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { id?: string; paused?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { id, paused }." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Which run?" }, { status: 400 });
  const paused = body.paused !== false;

  const db = supabaseAdmin();
  const { data: run } = await db
    .from("event_runs")
    .select("id, status")
    .eq("id", body.id)
    .eq("account_id", user.id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (run.status !== "grading") {
    return NextResponse.json({ error: "Only a grading run can be paused." }, { status: 409 });
  }

  const { data: held, error } = await db
    .from("event_runs")
    .update({ paused })
    .eq("id", run.id)
    .eq("status", "grading")
    .select("id");
  if (error) return NextResponse.json({ error: "Could not pause it." }, { status: 500 });
  // The write is guarded on status, so it can match nothing: the run finished between the check
  // above and here. Reporting the hold anyway would draw a pause the worker is not honouring.
  if (!held?.length) {
    return NextResponse.json({ error: "That run is no longer grading." }, { status: 409 });
  }

  // Resuming restarts the queue window for what the hold was keeping.
  //
  // The worker expires a queued grade that has waited past its window, and the pause guard only
  // shielded these while `paused` was true. Nothing bumped submitted_at, so a run paused for longer
  // than the event window (12h) had its ENTIRE held field failed on the first maintenance pass after
  // resuming, with "no worker was available to run it", which is also a lie: the organizer's own
  // hold was the reason. Pausing overnight is the ordinary use of this button, so the feature
  // destroyed exactly what it exists to protect.
  //
  // Bumping submitted_at is the smallest honest fix: the wait these grades did while held was not
  // time the queue failed them, so it should not count against them. It also puts them behind
  // anything queued during the pause, which is the fair order.
  if (!paused) {
    const { error: resumeErr } = await db
      .from("grades")
      .update({ submitted_at: new Date().toISOString() })
      .eq("event_run_id", run.id)
      .eq("status", "queued");
    if (resumeErr) {
      // The hold is already lifted, so say what is true rather than implying nothing happened.
      console.error("resume: could not restart the queue window:", resumeErr.message);
      return NextResponse.json(
        { paused, warning: "Resumed, but the queue window could not be restarted. Watch for grades timing out." },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ paused });
}
