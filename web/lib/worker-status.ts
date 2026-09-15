import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gradingOpen, GRADING_CLOSED_MESSAGE, GRADING_PAUSED_MESSAGE } from "@/lib/flags";

/** Is there a worker, and if not, what should we say?
 *
 *  The worker heartbeats every 15 seconds into worker_status. Three places need to read that and
 *  until now only one did: /api/health told a monitor the truth while /api/status kept offering the
 *  form and POST /api/grade kept accepting into a queue nothing would drain.
 *
 *  What that cost is worth stating, because it is not "the page looked wrong". expire_queued_jobs
 *  runs INSIDE the worker, so while the worker is stopped nothing expires; submissions pile up to
 *  MAX_QUEUE_DEPTH and everyone after is turned away. Then the first pass after the worker returns
 *  fails every one of them with "no worker was available to run it". A planned outage therefore ends
 *  by destroying everything submitted during it, in one sweep, blaming a worker that was stopped on
 *  purpose. The v3 corpus sprint is 7.6 days of exactly that.
 *
 *  So stopping the service is the signal. Nothing to remember and nothing to switch back, which also
 *  means it covers the outages nobody planned.
 */

/** Six missed beats. Generous on purpose: a routine restart should not read as an outage, and the
 *  cost of the extra minute is a door that stays shut slightly too long rather than one that opens
 *  onto nothing. Shared so health, status and the door cannot drift to different definitions of
 *  dead. */
export const HEARTBEAT_STALE_SECONDS = 90;

export type Liveness = {
  alive: boolean;
  /** The operator's message, set by worker/deploy/maintenance.sh before the service is stopped. */
  note: string | null;
  /** The heartbeat could not be read at all, which is not the same as there being no worker. */
  unreadable: boolean;
  ageSeconds: number | null;
};

export async function workerLiveness(db: SupabaseClient): Promise<Liveness> {
  const { data, error } = await db
    .from("worker_status")
    .select("last_seen, paused_note")
    .eq("id", "worker")
    .maybeSingle();

  // Fails OPEN, like the queue depth and lane checks beside it at the door. An unreadable row is not
  // evidence of a missing worker, and closing the site on a transient database fault is the worse of
  // the two mistakes. A monitor is told the truth about this separately, in /api/health, where
  // blindness IS the thing worth waking someone for.
  if (error) {
    console.error("worker heartbeat unreadable:", error.message);
    return { alive: true, note: null, unreadable: true, ageSeconds: null };
  }

  const lastSeen = data?.last_seen ? Date.parse(data.last_seen as string) : 0;
  const ageSeconds = lastSeen ? Math.round((Date.now() - lastSeen) / 1000) : null;
  return {
    alive: ageSeconds !== null && ageSeconds < HEARTBEAT_STALE_SECONDS,
    note: ((data?.paused_note as string | null) ?? null)?.trim() || null,
    unreadable: false,
    ageSeconds,
  };
}

/** Said by the routes that make the worker FETCH rather than grade: a gallery resolve, a Devpost
 *  re-check, a served-file and DNS proof. "Not taking new grades" is the wrong sentence for someone
 *  trying to verify a domain, and being told the wrong thing is how a working feature gets reported
 *  as broken. */
export const CHECKS_PAUSED_MESSAGE =
  "Sloptic cannot run checks right now. Try again later.";

/**
 * The refusal every route that needs the worker should make, or null to carry on.
 *
 * ONE function because there are ten such routes and they were gated three different ways: the grade
 * door checked the flag and the heartbeat, two event routes checked only the flag, and seven checked
 * nothing at all. So a visitor could not queue a grade during an outage but could still start a
 * gallery resolve that spins on "Reading the gallery" until somebody comes back, or file a domain
 * claim that is never checked. The same failure, quieter, spread across routes nobody would think to
 * look at while stopping a service.
 *
 * The operator's note outranks both generics, because it is the only one that can say how long.
 */
export async function gradingUnavailable(
  db: SupabaseClient,
  kind: "grade" | "check" = "grade",
): Promise<NextResponse | null> {
  // GRADING_OPEN gates GRADING, which is what it has always meant and all it has ever gated. A
  // gallery resolve or a domain proof is worker work but it is not a grade, and folding the flag in
  // here would have switched verification off on every deployment that has grading deliberately
  // closed, which is a behaviour change wearing the clothes of an outage fix. The heartbeat is the
  // signal that actually answers "is there a worker", and it covers both kinds.
  if (kind === "grade" && !gradingOpen()) {
    return NextResponse.json({ error: GRADING_CLOSED_MESSAGE }, { status: 503 });
  }
  const live = await workerLiveness(db);
  if (live.alive) return null;
  console.warn(`refusing ${kind}: no worker heartbeat (age ${live.ageSeconds ?? "never"}s)`);
  const fallback = kind === "grade" ? GRADING_PAUSED_MESSAGE : CHECKS_PAUSED_MESSAGE;
  return NextResponse.json({ error: live.note || fallback }, { status: 503 });
}
