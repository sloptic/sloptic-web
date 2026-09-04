// One module for reading an account's event runs with their fields, so the events API and the
// event page itself cannot drift apart: the page seeds the client with the same shape the client
// would otherwise fetch, which is the difference between a field that paints with the page and one
// that waits for a second round trip.
//
// The heavy jsonb (full ranking, blocked probe id arrays) is read HERE and reduced to the compact
// marks a list needs, never shipped to the browser: a 110-entry field polled every few seconds
// should carry kilobytes, not tens of them per grade.

import { supabaseAdmin } from "@/lib/supabase";
import { recoveryMarks, type RecoveryMarks } from "@/lib/grades";

export type Progress = { done?: number; total?: number; label?: string } | null;

export type Grade = {
  status: string;
  progress: Progress;
  claimed_at: string | null;
  finished_at: string | null;
  retry_due_at: string | null;
  retry_passes: number;
  /** What the challenge-recovery passes did (B pending is carried by retry_due_at), plus the
   *  grader's limited-engagement note. Computed here from columns the browser never sees. */
  marks: RecoveryMarks;
};

export type Entry = {
  project_url: string;
  app_url: string | null;
  skip_reason: string | null;
  grade_id: string | null;
  grades?: Grade | Grade[] | null;
};

export type Run = {
  id: string;
  slug: string;
  mode: "passive" | "active";
  status: "resolving" | "ready" | "grading" | "done" | "failed" | "cancelled";
  override: boolean;
  admin: boolean;
  priority: number | null;
  entries_found: number | null;
  gallery_complete: boolean | null;
  detail: string | null;
  created_at: string;
  resolved_at: string | null;
  event_entries: Entry[];
};

// `ranking->reporting` pulls just the engagement note, not the whole ranking jsonb.
const RUN_SELECT =
  "id, slug, mode, status, override, admin, priority, entries_found, gallery_complete, detail, created_at, resolved_at, " +
  "event_entries(project_url, app_url, skip_reason, grade_id, " +
  "grades(status, progress, claimed_at, finished_at, retry_due_at, retry_passes, " +
  "results(blocked_probes, retry_blocked_initial, challenge_stage, ranking->reporting)))";

/** PostgREST returns an embedded one-to-one as an object on some versions and an array on others. */
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function toGrade(g: Record<string, unknown> | null | undefined): Grade | null {
  if (!g) return null;
  const res = (one(g.results as Record<string, unknown> | Record<string, unknown>[]) ?? {}) as {
    blocked_probes?: string[] | null;
    retry_blocked_initial?: number | null;
    challenge_stage?: string | null;
    reporting?: { status?: string } | null;
  };
  return {
    status: String(g.status ?? ""),
    progress: (g.progress as Progress) ?? null,
    claimed_at: (g.claimed_at as string | null) ?? null,
    finished_at: (g.finished_at as string | null) ?? null,
    retry_due_at: (g.retry_due_at as string | null) ?? null,
    retry_passes: typeof g.retry_passes === "number" ? g.retry_passes : 0,
    marks: recoveryMarks({
      retryDueAt: (g.retry_due_at as string | null) ?? null,
      retryPasses: typeof g.retry_passes === "number" ? g.retry_passes : 0,
      initial: res.retry_blocked_initial,
      blocked: (res.blocked_probes ?? []).length,
      // One L for both causes: the app's surface was small, or a challenge cut the battery short.
      limitedEngagement: res.reporting?.status === "limited_engagement" || res.challenge_stage === "limited",
    }),
  };
}

function toRun(row: Record<string, unknown>): Run {
  const entries = (row.event_entries as Record<string, unknown>[] | null) ?? [];
  return {
    id: String(row.id),
    slug: String(row.slug),
    mode: (row.mode as Run["mode"]) ?? "passive",
    status: (row.status as Run["status"]) ?? "resolving",
    override: row.override === true,
    admin: row.admin === true,
    priority: (row.priority as number | null) ?? null,
    entries_found: (row.entries_found as number | null) ?? null,
    gallery_complete: (row.gallery_complete as boolean | null) ?? null,
    detail: (row.detail as string | null) ?? null,
    created_at: String(row.created_at),
    resolved_at: (row.resolved_at as string | null) ?? null,
    event_entries: entries.map((e) => ({
      project_url: String(e.project_url),
      app_url: (e.app_url as string | null) ?? null,
      skip_reason: (e.skip_reason as string | null) ?? null,
      grade_id: (e.grade_id as string | null) ?? null,
      grades: toGrade(one(e.grades as Record<string, unknown> | Record<string, unknown>[])),
    })),
  };
}

/** This account's runs, newest first, with their resolved fields. */
export async function runsForAccount(accountId: string, slug?: string): Promise<Run[]> {
  let q = supabaseAdmin()
    .from("event_runs")
    .select(RUN_SELECT)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (slug) q = q.eq("slug", slug);
  const { data, error } = await q;
  if (error) throw new Error("Could not list runs.");
  return (data as unknown as Record<string, unknown>[]).map(toRun);
}
