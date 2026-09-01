import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { gradingOpen } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The worker writes a heartbeat every 15s. Allow generous slack for a slow poll or clock skew, the
// same window the grade page uses, so the two never disagree about whether a worker exists.
const HEARTBEAT_STALE_SECONDS = 90;

// GET /api/health -> 200 when grading actually works end to end, 503 when it does not.
//
// Written for a dumb external monitor (UptimeRobot, Better Stack, a cron with curl), which is why
// the VERDICT is the HTTP status rather than a field in the body: anything that can watch a URL can
// watch this, with no parsing and no configuration. /api/status stays as it is, since the landing
// page asks a different question (may I offer the form) and must not start alerting.
//
// Degraded means "a grade submitted right now would not finish": grading switched off, no worker
// heartbeat, or a heartbeat too old to trust. A slow queue is NOT degraded, since the work is
// getting done, so the depth is reported for context and never fails the check.
export async function GET() {
  const open = gradingOpen();
  const db = supabaseAdmin();

  const [{ data: worker, error: workerErr }, { count: queued, error: queueErr }] = await Promise.all([
    db.from("worker_status").select("last_seen, state, in_flight").eq("id", "worker").maybeSingle(),
    db.from("grades").select("id", { count: "exact", head: true }).eq("status", "queued"),
  ]);

  // Unlike the grade page, which assumes a worker is alive when it cannot read the heartbeat (there
  // the cost of being wrong is telling a visitor something false), a monitor should be told the
  // truth about its own blindness. An unreadable heartbeat IS a problem worth waking up for.
  const lastSeen = worker?.last_seen ? Date.parse(worker.last_seen) : 0;
  const ageSeconds = lastSeen ? Math.round((Date.now() - lastSeen) / 1000) : null;
  const workerAlive = !workerErr && ageSeconds !== null && ageSeconds < HEARTBEAT_STALE_SECONDS;

  const problems: string[] = [];
  if (!open) problems.push("grading is switched off");
  if (workerErr) problems.push(`worker status unreadable: ${workerErr.message}`);
  else if (ageSeconds === null) problems.push("no worker has ever checked in");
  else if (!workerAlive) problems.push(`worker heartbeat is ${ageSeconds}s old`);
  if (queueErr) problems.push(`queue unreadable: ${queueErr.message}`);

  const ok = problems.length === 0;
  return NextResponse.json(
    {
      ok,
      problems,
      grading_open: open,
      worker: {
        alive: workerAlive,
        heartbeat_age_seconds: ageSeconds,
        state: worker?.state ?? null,
        in_flight: worker?.in_flight ?? null,
      },
      queued: queued ?? null,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
