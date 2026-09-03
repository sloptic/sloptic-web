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
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  // `progress` is display-only and arrived in a later migration, so ask for it but never let its
  // absence break the lookup: a report that already exists must keep rendering on a database that
  // has not been migrated yet. Anything else turns an optional flourish into a 500 on a finished
  // grade, which is what happened when this shipped ahead of its migration.
  const CORE = "id, status, submitted_url, submitted_at, finished_at, error";
  let { data: grade, error } = await db
    .from("grades")
    .select(`${CORE}, progress, account_id, retry_due_at, retry_passes`)
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
      "mode, catalog_version, passive_probe_count, slop_score, axis_slop, coverage, platform, surface, findings, card, outcomes, percentile, percentile_band, curve_version, ranking, blocked_probes, incomplete_axes";
    let { data: r, error: rErr } = await db
      .from("results")
      .select(`${RESULT_COLS}, bot_challenge, challenge_stage`)
      .eq("grade_id", params.id)
      .maybeSingle();
    if (rErr?.code === "42703") {
      console.warn("results.bot_challenge/challenge_stage missing; falling back (apply migration 0020)");
      ({ data: r } = await db.from("results").select(RESULT_COLS).eq("grade_id", params.id).maybeSingle());
    }
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
    progress:
      grade.status === "running"
        ? ((grade as { progress?: unknown }).progress as GradeView["progress"]) ?? null
        : null,
    // The blocked-tail recovery, so the report can say a second pass is coming rather than present a
    // truncated grade as finished. On a database without these columns the fallback select above
    // drops them and they read as "no retry", which is correct there.
    retry_due_at: (grade as { retry_due_at?: string | null }).retry_due_at ?? null,
    retry_passes: (grade as { retry_passes?: number }).retry_passes ?? 0,
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
