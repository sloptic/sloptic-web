import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { GradeView, GradeResult, QueueInfo } from "@/lib/types";

// A worker writes its heartbeat every poll (5s). Allow generous slack for a slow poll or a clock
// skew before calling it dead: this only decides whether we EXPLAIN the wait, never whether we grade.
const HEARTBEAT_STALE_SECONDS = 90;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/grade/:id  ->  poll status; includes the result once status === "done".
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: grade, error } = await db
    .from("grades")
    .select("id, status, submitted_url, submitted_at, error")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  if (!grade) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let result: GradeResult | null = null;
  if (grade.status === "done") {
    const { data: r } = await db
      .from("results")
      .select(
        "mode, catalog_version, passive_probe_count, slop_score, axis_slop, coverage, platform, surface, findings"
      )
      .eq("grade_id", params.id)
      .maybeSingle();
    result = (r as GradeResult) ?? null;
  }

  // While queued, work out WHY the user is waiting. A queue that is merely busy and a system with
  // nothing running look identical from the outside, and the second is the one worth admitting to.
  let queue: QueueInfo | undefined;
  if (grade.status === "queued") {
    const [{ data: worker, error: workerErr }, { count: ahead }] = await Promise.all([
      db.from("worker_status").select("last_seen, state").eq("id", "worker").maybeSingle(),
      db
        .from("grades")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued")
        .lt("submitted_at", grade.submitted_at),
    ]);
    // Failing to READ the heartbeat is not evidence that no worker exists. A missing grant on the
    // table made every read 403, and reporting that as "nothing is running" told visitors something
    // confidently false while the worker was polling. On an error, say nothing rather than lie: the
    // page falls back to the ordinary "this takes a few minutes" copy.
    if (workerErr) console.error("worker_status unreadable:", workerErr.message);
    const lastSeen = worker?.last_seen ? Date.parse(worker.last_seen) : 0;
    const workerAlive = workerErr
      ? true
      : lastSeen > 0 && Date.now() - lastSeen < HEARTBEAT_STALE_SECONDS * 1000;
    queue = {
      worker_alive: workerAlive,
      stalled: !workerAlive,
      ahead: ahead ?? 0,
      waiting_seconds: Math.max(0, Math.round((Date.now() - Date.parse(grade.submitted_at)) / 1000)),
    };
  }

  const view: GradeView = {
    id: grade.id,
    status: grade.status,
    url: grade.submitted_url,
    submitted_at: grade.submitted_at,
    error: grade.error,
    result,
    queue,
  };
  return NextResponse.json(view);
}
