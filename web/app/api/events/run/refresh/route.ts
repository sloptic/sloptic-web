import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/run/refresh  { id }  ->  re-resolve a run's field.
//
// For late submissions. The Devpost submit cache makes this cheap: the gallery is re-listed fresh,
// but a submission already pulled is read from cache unless it changed. The worker's field write
// merges: graded entries keep their rows, ungraded ones take the fresh app URL and skip decision,
// and only entries the gallery dropped (never graded) are removed. Refused while already resolving;
// a cancelled run stays cancelled.

const REFRESHABLE = ["ready", "grading", "done", "failed"] as const;

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
  if (run.status === "resolving") {
    return NextResponse.json({ error: "Already reading the gallery." }, { status: 409 });
  }
  if (!REFRESHABLE.includes(run.status as (typeof REFRESHABLE)[number])) {
    return NextResponse.json({ error: "A cancelled run stays cancelled." }, { status: 409 });
  }
  // started_at cleared too: it is what marks the run as claimed, and the worker only picks up an
  // unclaimed resolving run. refresh_requested switches the worker's resolve into re-check mode:
  // every submission is fetched again and compared with the cache, so the counts it reports are
  // measurements, not guesses.
  const { error } = await db
    .from("event_runs")
    .update({ status: "resolving", started_at: null, finished_at: null, refresh_requested: true, paused: false })
    .eq("id", run.id);
  if (error) return NextResponse.json({ error: "Could not start the refresh." }, { status: 500 });
  return NextResponse.json({ refreshing: true });
}
