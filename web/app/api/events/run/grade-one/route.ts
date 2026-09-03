import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { normalizeTarget } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/run/grade-one  { runId, projectUrls[] }  ->  queue a chosen subset.
//
// The drip feed. An organizer grading the apps that just demoed is the only way to be sure active
// traffic never lands on an app a judge is looking at, because the safe window is defined by
// something we cannot see and they can. Takes a list, since ticking the five teams that just
// presented is the actual gesture; one is just a list of one.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { runId?: string; projectUrl?: string; projectUrls?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { runId, projectUrls }." }, { status: 400 });
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

  const wanted = body.projectUrls ?? (body.projectUrl ? [body.projectUrl] : []);
  if (wanted.length === 0) return NextResponse.json({ error: "Nothing selected." }, { status: 400 });

  // Only entries of THIS run that are gradeable and not already queued. Anything the caller listed
  // that does not match is simply absent from the result, so a stale page cannot double-queue.
  const { data: entries } = await db
    .from("event_entries")
    .select("id, project_url, app_url")
    .eq("run_id", run.id)
    .in("project_url", wanted.slice(0, 600))
    .is("skip_reason", null)
    .is("grade_id", null);
  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: "Nothing left to grade in that selection." }, { status: 409 });
  }

  const bad: string[] = [];
  const rows = entries.flatMap((e) => {
    try {
      const target = normalizeTarget(e.app_url ?? "");
      return [{
        id: randomUUID(),
        entry_id: e.id,
        origin: target.origin,
        submitted_url: e.app_url,
        mode: run.mode,
        status: "queued",
        account_id: user.id,
        event_run_id: run.id,
      }];
    } catch {
      bad.push(e.id);
      return [];
    }
  });

  if (rows.length) {
    const { error } = await db.from("grades").insert(rows.map(({ entry_id, ...g }) => g));
    if (error) {
      console.error("drip enqueue failed:", error.message);
      return NextResponse.json({ error: "Could not queue them." }, { status: 500 });
    }
    await Promise.all(
      rows.map((g) => db.from("event_entries").update({ grade_id: g.id }).eq("id", g.entry_id)),
    );
  }
  // Outside the block above: a selection of nothing but unusable links queues nothing, and leaving
  // them unmarked would leave them tickable forever with no way to find out why.
  await Promise.all(
    bad.map((id) => db.from("event_entries").update({ skip_reason: "unusable link" }).eq("id", id)),
  );

  // The run enters grading on the first one. It settles only when every gradeable entry has a grade,
  // so the long gaps between demos do not read as a finished board.
  if (run.status === "ready") {
    await db
      .from("event_runs")
      .update({ status: "grading", started_at: new Date().toISOString() })
      .eq("id", run.id);
  }
  return NextResponse.json({ queued: rows.length });
}
