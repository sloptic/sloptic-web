import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { normalizeTarget } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/run/grade-one  { runId, projectUrl }  ->  queue ONE entry.
//
// The drip feed. An organizer grading app by app as each team finishes demoing is the only way to be
// sure active traffic never lands on an app a judge is looking at, because the safe window is defined
// by something we cannot see and they can.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { runId?: string; projectUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { runId, projectUrl }." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: run } = await db
    .from("event_runs")
    .select("id, slug, mode, status")
    .eq("id", body.runId ?? "")
    .eq("account_id", user.id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  if (!["ready", "grading"].includes(run.status)) {
    return NextResponse.json({ error: `This run is ${run.status}.` }, { status: 409 });
  }

  const { data: entry } = await db
    .from("event_entries")
    .select("id, app_url, skip_reason, grade_id")
    .eq("run_id", run.id)
    .eq("project_url", body.projectUrl ?? "")
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: "No such entry." }, { status: 404 });
  if (entry.skip_reason) return NextResponse.json({ error: "That entry is skipped." }, { status: 409 });
  if (entry.grade_id) return NextResponse.json({ error: "Already graded." }, { status: 409 });

  let target;
  try {
    target = normalizeTarget(entry.app_url ?? "");
  } catch {
    await db.from("event_entries").update({ skip_reason: "unusable link" }).eq("id", entry.id);
    return NextResponse.json({ error: "That entry's link is not a usable URL." }, { status: 409 });
  }

  const id = randomUUID();
  const { error } = await db.from("grades").insert({
    id,
    origin: target.origin,
    submitted_url: entry.app_url,
    mode: run.mode,
    status: "queued",
    account_id: user.id,
    event_run_id: run.id,
  });
  if (error) {
    console.error("drip enqueue failed:", error.message);
    return NextResponse.json({ error: "Could not queue it." }, { status: 500 });
  }
  await db.from("event_entries").update({ grade_id: id }).eq("id", entry.id);

  // The run enters grading on the first one. It settles only when every gradeable entry has a grade,
  // so the long gaps between demos do not read as a finished board.
  if (run.status === "ready") {
    await db
      .from("event_runs")
      .update({ status: "grading", started_at: new Date().toISOString() })
      .eq("id", run.id);
  }
  return NextResponse.json({ queued: id });
}
