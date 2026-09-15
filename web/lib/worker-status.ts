import type { SupabaseClient } from "@supabase/supabase-js";

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
