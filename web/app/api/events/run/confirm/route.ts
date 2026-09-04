import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { normalizeTarget } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A ceiling on one run, so a mistake cannot enqueue thousands. Well above a real hackathon field. */
const MAX_ENTRIES = 600;

// POST /api/events/run/confirm  { id, regrade? }  ->  queue the gradeable entries.
//
// This is the authorization step. Everything before it only looked at a gallery; this points traffic
// at other people's apps, which is why it acts on a field the organizer has seen rather than on
// whatever the resolver finds at the time.
//
// `regrade` re-queues entries that already have a grade: the typical case is a run switched from
// passive to active after some reports landed, and the organizer wants one battery across the
// board. The entry's link is repointed at the new grade when it is queued, so the board follows the
// freshest measurement; the old reports stay at their own links.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { id?: string; regrade?: boolean };
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

  const regrade = body.regrade === true;
  let entriesQuery = db
    .from("event_entries")
    .select("id, app_url")
    .eq("run_id", run.id)
    .is("skip_reason", null);
  if (!regrade) entriesQuery = entriesQuery.is("grade_id", null);
  const { data: entries } = await entriesQuery.limit(MAX_ENTRIES);

  if (!entries || entries.length === 0) {
    return NextResponse.json(
      { error: regrade ? "Nothing to regrade." : "Nothing left to grade." },
      { status: 409 }
    );
  }

  // One insert for the whole field, with ids generated here so the entries can be linked without
  // reading anything back. The previous version did two round trips per entry, which for a 52 app
  // event is over a hundred, taking long enough that closing the tab could abort the handler partway
  // and leave a field half queued.
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

  if (rows.length === 0) {
    return NextResponse.json({ error: "Nothing in this field can be graded." }, { status: 409 });
  }

  const { error: insErr } = await db
    .from("grades")
    .insert(rows.map(({ entry_id, ...g }) => g));
  if (insErr) {
    console.error("event enqueue failed:", insErr.message);
    return NextResponse.json({ error: "Could not queue the grades." }, { status: 500 });
  }

  // Link and flip in parallel. A link that survived the screen but will not normalize is that
  // entry's problem, so it is marked and the rest proceed.
  await Promise.all([
    ...rows.map((g) => db.from("event_entries").update({ grade_id: g.id }).eq("id", g.entry_id)),
    ...bad.map((id) =>
      db.from("event_entries").update({ skip_reason: "unusable link" }).eq("id", id)
    ),
    db.from("event_runs")
      .update({ status: "grading", started_at: new Date().toISOString(), paused: false })
      .eq("id", run.id),
  ]);
  const queued = rows.length;

  return NextResponse.json({ queued, mode: run.mode });
}
