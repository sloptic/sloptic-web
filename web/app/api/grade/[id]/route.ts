import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { GradeView, GradeResult, QueueInfo } from "@/lib/types";
import { currentUser } from "@/lib/auth";
import { ANON_REPORT_DAYS, reportExpiresAt } from "@/lib/retention";

// A worker writes its heartbeat every poll (5s). Allow generous slack for a slow poll or a clock
// skew before calling it dead: this only decides whether we EXPLAIN the wait, never whether we grade.
const HEARTBEAT_STALE_SECONDS = 90;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/** How long this report has left, computed in one place so the page never has to know the window.
 *  Returns nothing at all when the ownership column is not there yet, since "unknown" must not be
 *  rendered as "expires in 30 days" on a database that expires nothing. */
function retention(grade: { account_id?: unknown; finished_at?: string | null }) {
  if (!("account_id" in grade)) return {};
  const claimed = grade.account_id !== null && grade.account_id !== undefined;
  const when = reportExpiresAt(grade.finished_at ?? null, claimed);
  return { claimed, expires_at: when ? when.toISOString() : null, retain_days: ANON_REPORT_DAYS };
}

// GET /api/grade/:id  ->  poll status; includes the result once status === "done".
/** Report ids are uuids and the id IS the capability, so anything else is a typo or a probe.
 *  Answering both with the same 404 keeps the two indistinguishable. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const db = supabaseAdmin();

  // `progress` is display-only and arrived in a later migration, so ask for it but never let its
  // absence break the lookup: a report that already exists must keep rendering on a database that
  // has not been migrated yet. Anything else turns an optional flourish into a 500 on a finished
  // grade, which is what happened when this shipped ahead of its migration.
  const CORE = "id, origin, status, submitted_url, submitted_at, finished_at, error";
  let { data: grade, error } = await db
    .from("grades")
    .select(`${CORE}, progress, account_id, retry_due_at, retry_passes, event_run_id, claimed_at`)
    .eq("id", params.id)
    .maybeSingle();

  if (error?.code === "42703") {
    console.warn("grades.progress/account_id missing; falling back (apply migrations 0006, 0009)");
    ({ data: grade, error } = await db.from("grades").select(CORE).eq("id", params.id).maybeSingle());
  }

  if (error) return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  if (!grade) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let result: GradeResult | null = null;
  if (grade.status === "done") {
    // blocked_probes/incomplete_axes shipped in 0018 and are safe to read; bot_challenge/
    // challenge_stage in 0020 may not be applied yet, so fall back without them rather than 500 a
    // report on a database that predates the column. The withheld/interrupted note derives from
    // blocked_probes + coverage + outcomes, which are all present here either way.
    const RESULT_COLS =
      "mode, catalog_version, passive_probe_count, slop_score, axis_slop, axis_potential, coverage, platform, surface, findings, card, outcomes, percentile, percentile_band, curve_version, ranking, blocked_probes, incomplete_axes";
    let { data: r, error: rErr } = await db
      .from("results")
      .select(`${RESULT_COLS}, bot_challenge, challenge_stage, retry_blocked_initial, challenge_onset_index`)
      .eq("grade_id", params.id)
      .maybeSingle();
    if (rErr?.code === "42703") {
      console.warn("results challenge/retry columns missing; falling back (apply migrations 0020, 0021, 0022)");
      const fb = await db.from("results").select(RESULT_COLS).eq("grade_id", params.id).maybeSingle();
      r = fb.data as typeof r;
      rErr = fb.error;
    }
    // A read that failed is not a report that expired. Falling through with a null result renders
    // the retention page, which tells someone their report is gone over a database hiccup.
    if (rErr) return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
    result = (r as GradeResult) ?? null;
  }

  // The event run that queued this grade, so the report can link back to the event it serves and
  // reflect the run's pause. Only the slug travels as provenance; paused travels so a held retry
  // can say so, and canResume so the resume button shows for the organizer alone. The grade link
  // is shareable in a way the event is not, so everyone sees the state and only the owner acts.
  let event: { slug: string; runId: string; paused: boolean; canResume: boolean } | null = null;
  const runId = (grade as { event_run_id?: string | null }).event_run_id;
  if (runId) {
    const viewer = await currentUser();
    const { data: run } = await db
      .from("event_runs")
      .select("id, slug, paused, account_id")
      .eq("id", runId)
      .maybeSingle();
    if (run) {
      event = {
        slug: run.slug,
        runId: run.id,
        paused: run.paused === true,
        canResume: viewer !== null && viewer.id === run.account_id,
      };
    }
  }

  // While queued, work out WHY the user is waiting. A queue that is merely busy and a system with
  // nothing running look identical from the outside, and the second is the one worth admitting to.
  let queue: QueueInfo | undefined;
  if (grade.status === "queued") {
    // Counted the way the worker CLAIMS, not the way the table is ordered. Every public grade goes
    // before every event grade (see claim_job), so a single submission is not behind an organizer's
    // 400 app field, and telling someone it is turns a two minute wait into an apparent all day one.
    // On the event side this counts the public queue plus the same run's own grades ahead: another
    // event's run can still sit between them, so that number is a floor.
    const publicAhead = db
      .from("grades")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued")
      .is("event_run_id", null);
    const [{ data: worker, error: workerErr }, { count: ahead }] = await Promise.all([
      db.from("worker_status").select("last_seen, state").eq("id", "worker").maybeSingle(),
      runId
        ? publicAhead
        : publicAhead.lt("submitted_at", grade.submitted_at),
    ]);
    let aheadTotal = ahead ?? 0;
    if (runId) {
      const { count: sameRun } = await db
        .from("grades")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued")
        .eq("event_run_id", runId)
        .lt("submitted_at", grade.submitted_at);
      aheadTotal += sameRun ?? 0;
    }
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
      ahead: aheadTotal,
      waiting_seconds: Math.max(0, Math.round((Date.now() - Date.parse(grade.submitted_at)) / 1000)),
    };
  }

  // Whether the VIEWER owns this report, which is not the same question as whether anyone does.
  // The footer used to read the second and answer the first, so a link holder was told the report
  // was saved to their account and then got a 403 from the delete button under it. Only asked when
  // the report is claimed: an anonymous one is the link holder's to delete.
  const owner = "account_id" in grade ? ((grade as { account_id?: string | null }).account_id ?? null) : null;
  const mine = owner === null ? false : (await currentUser())?.id === owner;

  const view: GradeView = {
    id: grade.id,
    status: grade.status,
    url: grade.submitted_url,
    // What was actually graded. The worker pins the run to the origin (egress.origin_scope), so a
    // submitted path is where the submitter pointed, not what the report covers.
    origin: (grade as { origin?: string | null }).origin ?? grade.submitted_url,
    submitted_at: grade.submitted_at,
    error: grade.error,
    result,
    queue,
    progress:
      grade.status === "running"
        ? ((grade as { progress?: unknown }).progress as GradeView["progress"]) ?? null
        : null,
    // The blocked-tail recovery, so the report can say a second pass is coming rather than present a
    // truncated grade as finished. On a database without these columns the fallback select above
    // drops them and they read as "no retry", which is correct there.
    // When the worker actually claimed the grade. For event grades this can be far later than
    // submitted_at (queue, pauses), and the running timer must start at zero when grading starts.
    claimed_at: (grade as { claimed_at?: string | null }).claimed_at ?? null,
    mine,
    retry_due_at: (grade as { retry_due_at?: string | null }).retry_due_at ?? null,
    retry_passes: (grade as { retry_passes?: number }).retry_passes ?? 0,
    event,
    ...retention(grade as { account_id?: unknown; finished_at?: string | null }),
  };
  return NextResponse.json(view);
}

// DELETE /api/grade/:id  ->  destroy the grade and its report.
//
// Who may: whoever holds the URL, while nobody owns the grade. That sounds loose and is not, because
// holding the URL is already total read access, so deletion adds no capability an attacker lacked;
// what it adds is a REMEDY. Anyone can grade an app they do not own, so the person best placed to
// want a report gone is the one it is about, and they will only ever have the link.
//
// Once an account claims a grade, only that account may delete it: a claim is the point at which
// someone takes responsibility for the row, and a stranger with an old link must not undo it.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Already gone is the outcome a delete asked for, and a malformed id names nothing to delete.
  if (!UUID.test(params.id)) return NextResponse.json({ deleted: true });
  const db = supabaseAdmin();

  const { data: grade, error } = await db
    .from("grades")
    .select("id, account_id")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  // Already gone is the outcome the caller asked for, so do not make them handle a 404 for it.
  if (!grade) return NextResponse.json({ deleted: true });

  if (grade.account_id) {
    const user = await currentUser();
    if (!user || user.id !== grade.account_id) {
      return NextResponse.json(
        { error: "This grade belongs to an account. Sign in to delete it." },
        { status: 403 }
      );
    }
  }

  // results.grade_id is ON DELETE CASCADE, so the report goes with it.
  const { error: delErr } = await db.from("grades").delete().eq("id", params.id);
  if (delErr) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
