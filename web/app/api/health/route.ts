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
    db
      .from("worker_status")
      .select("last_seen, state, reason, in_flight, blocked_lanes")
      .eq("id", "worker")
      .maybeSingle(),
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
  if (workerErr) {
    // The message is a PostgREST error, which names columns, roles and missing grants. This route
    // is unauthenticated, so it says that a read failed and nothing about why.
    console.warn("health: worker status unreadable:", workerErr.message);
    problems.push("worker status unreadable");
  }
  else if (ageSeconds === null) problems.push("no worker has ever checked in");
  else if (!workerAlive) problems.push(`worker heartbeat is ${ageSeconds}s old`);
  if (queueErr) {
    console.warn("health: queue unreadable:", queueErr.message);
    problems.push("queue unreadable");
  }
  // A live worker that is deliberately not claiming is still a grade that would not finish, which
  // is this route's own definition of degraded. Reading only last_seen reported 200 straight
  // through it.
  //
  // Per lane now, because `state` says 'holding' only when NOTHING is claimable: with the public
  // budget spent and event allowance left the worker is honestly 'grading', and this route used to
  // answer 200 while every public submission was going nowhere. That is the one case where a
  // monitor most needs to speak up, since it happens under exactly the load that publicity creates.
  //
  // The PUBLIC lane decides the verdict, and the event lane only reports. This route's question is
  // whether a grade submitted right now would finish, and a stranger submitting one URL is on the
  // public lane; an event lane at its ceiling is an organizer-facing condition their board already
  // shows. Degrading on it would page whoever is on call because an organizer graded 500 apps,
  // exactly as designed, and a monitor that cries at correct behaviour gets muted and then it
  // protects nothing. Both lanes blocked still degrades, because public is one of them.
  //
  // The public lane reaching its cap DOES page you, and that is intended: it means demand exceeded
  // capacity, which is worth learning on the day rather than from logs a week later. It clears
  // itself when the 24h window rolls.
  const blocked = (worker?.blocked_lanes ?? {}) as Record<string, string>;
  const blockedLanes = Object.keys(blocked).sort();
  if (workerAlive && blocked.public) {
    problems.push(`worker is not claiming public: ${blocked.public}`);
  } else if (workerAlive && worker?.state === "holding") {
    // A worker older than migration 0034 publishes no lane map. Keep the coarse answer rather than
    // reporting healthy at it, since a half-deployed pair is exactly when a monitor earns its keep.
    problems.push(`worker is holding: ${worker?.reason || "not claiming any lane"}`);
  }

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
        // A BOOLEAN, never the id. worker_status.in_flight holds the uuid of the grade being
        // worked on, and a grade id is the whole capability: it reads the report and, while the
        // grade is unclaimed, deletes it. This route is unauthenticated and unrated, so publishing
        // that id let anyone poll every ten seconds and harvest most ids on the service. A monitor
        // needs to know whether the worker is busy, not which grade it is busy with.
        busy: Boolean(worker?.in_flight),
        // Lane NAMES only. The reasons are already spelled out in `problems`, and repeating them
        // here would just be two copies to keep in step.
        blocked_lanes: blockedLanes,
      },
      queued: queued ?? null,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
