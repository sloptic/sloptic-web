import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { normalizeTarget } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A ceiling on one run, so a mistake cannot enqueue thousands. Well above a real hackathon field. */
const MAX_ENTRIES = 600;

// POST /api/events/run/confirm  { id }  ->  queue the gradeable entries.
//
// This is the authorization step. Everything before it only looked at a gallery; this points traffic
// at other people's apps, which is why it acts on a field the organizer has seen rather than on
// whatever the resolver finds at the time.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { id }." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: run } = await db
    .from("event_runs")
    .select("id, slug, mode, status, override")
    .eq("id", body.id ?? "")
    .eq("account_id", user.id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  if (run.status !== "ready") {
    return NextResponse.json(
      { error: `This run is ${run.status}, so there is nothing to confirm.` },
      { status: 409 }
    );
  }

  const { data: entries } = await db
    .from("event_entries")
    .select("id, app_url")
    .eq("run_id", run.id)
    .is("skip_reason", null)
    .is("grade_id", null)
    .limit(MAX_ENTRIES);

  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: "Nothing in this field can be graded." }, { status: 409 });
  }

  let queued = 0;
  for (const e of entries) {
    let target;
    try {
      target = normalizeTarget(e.app_url ?? "");
    } catch {
      // A link that survived the screen but will not normalize is the entry's problem, not the run's.
      await db.from("event_entries").update({ skip_reason: "the app link is not a usable URL" }).eq("id", e.id);
      continue;
    }
    const { data: grade } = await db
      .from("grades")
      .insert({
        origin: target.origin,
        submitted_url: e.app_url,
        mode: run.mode,
        status: "queued",
        account_id: user.id,
        event_run_id: run.id,
      })
      .select("id")
      .single();
    if (grade) {
      await db.from("event_entries").update({ grade_id: grade.id }).eq("id", e.id);
      queued += 1;
    }
  }

  await db
    .from("event_runs")
    .update({ status: "grading", started_at: new Date().toISOString() })
    .eq("id", run.id);

  return NextResponse.json({ queued, mode: run.mode });
}
