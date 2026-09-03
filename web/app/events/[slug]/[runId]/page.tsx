import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import BoardTable, { type BoardRow, type DnfRow } from "./BoardTable";
import BoardStats from "./BoardStats";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Event board", robots: { index: false, follow: false } };

type Row = {
  name: string;
  project_url: string;
  grade_id: string | null;
  status: string | null;
  slop: number | null;
  axes: Record<string, number> | null;
  cleaner: number | null;
  potential: number | null;
  lighthouse: number | null;
  catastrophic: number | null;
  maxPenalty: number | null;
  categories: number | null;
  gated: boolean;
  // Did the probe loop run? A challenge can block the whole battery and still finish as status=done
  // with slop 0, which must never rank as the cleanest app. probes_total is written only once the
  // loop is reached.
  measured: boolean;
  blocked: number;
};

function fmt(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function projectName(url: string): string {
  return url.replace(/\/+$/, "").split("/").pop() || url;
}

export default async function BoardPage({ params }: { params: { slug: string; runId: string } }) {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=/events/${params.slug}/${params.runId}`);

  const db = supabaseAdmin();
  const { data: run } = await db
    .from("event_runs")
    .select("id, slug, mode, status, override, entries_found, gallery_complete, created_at")
    .eq("id", params.runId)
    .eq("account_id", user.id)
    .maybeSingle();
  if (!run) notFound();

  const { data: entries } = await db
    .from("event_entries")
    .select("project_url, skip_reason, grade_id")
    .eq("run_id", run.id);

  const ids = (entries ?? []).map((e) => e.grade_id).filter(Boolean) as string[];
  const { data: grades } = ids.length
    ? await db.from("grades").select("id, status").in("id", ids)
    : { data: [] as { id: string; status: string }[] };
  const { data: results } = ids.length
    ? await db.from("results").select("grade_id, slop_score, axis_slop, coverage, blocked_probes, ranking, lighthouse_score").in("grade_id", ids)
    : { data: [] as { grade_id: string; slop_score: number; axis_slop: Record<string, number>; coverage: Record<string, unknown> | null; blocked_probes: string[] | null; ranking: Record<string, unknown>; lighthouse_score: number | null }[] };

  const gradeStatus = new Map((grades ?? []).map((g) => [g.id, g.status]));
  const byGrade = new Map((results ?? []).map((r) => [r.grade_id, r]));

  const rows: Row[] = (entries ?? [])
    .filter((e) => e.grade_id)
    .map((e) => {
      const r = byGrade.get(e.grade_id as string);
      const rk = (r?.ranking ?? {}) as Record<string, unknown>;
      return {
        name: projectName(e.project_url),
        project_url: e.project_url,
        grade_id: e.grade_id,
        status: gradeStatus.get(e.grade_id as string) ?? null,
        slop: r ? Number(r.slop_score) : null,
        axes: (r?.axis_slop as Record<string, number>) ?? null,
        cleaner: rk.cleaner_than_pct === undefined || rk.cleaner_than_pct === null ? null : Number(rk.cleaner_than_pct),
        potential: typeof rk.slop_potential === "number" ? rk.slop_potential : null,
        lighthouse: r?.lighthouse_score ?? null,
        // The count when the grade has it, the boolean's 0/1 when it only has that, and null for
        // grades written before either, which must not read as a confident zero.
        maxPenalty: typeof rk.max_penalty === "number" ? rk.max_penalty : null,
        categories: typeof rk.categories_applied === "number" ? rk.categories_applied : null,
        catastrophic:
          typeof rk.catastrophe_findings === "number"
            ? rk.catastrophe_findings
            : rk.has_catastrophe === undefined
              ? null
              : rk.has_catastrophe === true
                ? 1
                : 0,
        gated: rk.has_catastrophe === true,
        measured: Number((r?.coverage as { probes_total?: number } | null)?.probes_total ?? 0) > 0,
        blocked: (r?.blocked_probes ?? []).length,
      };
    });

  // Graded, in order. Lower slop is better, and a gating finding sinks an app whatever it scored:
  // a leaked key with a low score is not a good entry, and a board that puts it first would be
  // telling an organizer the opposite of what happened.
  // The grader's own rank key, in the order the page claims: slop, then whether a gating finding
  // fired, then the worst single finding, then exposure survived, then breadth of coverage. Sorting
  // on slop alone would leave the explanation above describing something the table does not do.
  const ranked = rows
    .filter((r) => r.slop !== null && !r.gated && r.measured)
    .sort(
      (a, b) =>
        (a.slop as number) - (b.slop as number) ||
        (a.catastrophic ?? 0) - (b.catastrophic ?? 0) ||
        (a.maxPenalty ?? 0) - (b.maxPenalty ?? 0) ||
        (b.potential ?? 0) - (a.potential ?? 0) ||
        (b.categories ?? 0) - (a.categories ?? 0)
    );
  const gated = rows.filter((r) => r.gated);
  // Reached, answered, but the grade measured nothing: a challenge blocked the battery. Not a DNF
  // (the app was up) and not a clean 0 (nothing ran), so it sits in its own line off the ranking.
  const withheld = rows.filter((r) => r.slop !== null && !r.gated && !r.measured);
  // A grade that failed is not still running. It has finished and produced nothing, usually because
  // the deployment has since gone down, and calling it in progress leaves a board that never
  // finishes from the reader's side.
  const failed = rows.filter((r) => r.slop === null && !r.gated && r.status === "failed");
  const pending = rows.filter(
    (r) => r.slop === null && !r.gated && r.status !== "failed"
  );
  const boardRows: BoardRow[] = ranked.map((r) => ({
    name: r.name,
    project_url: r.project_url,
    grade_id: r.grade_id,
    slop: r.slop as number,
    // What share of its exposed surface an app actually lost. A big app and a small one compare on
    // this where they do not on the raw score.
    ratio: r.potential ? ((r.slop as number) / r.potential) * 100 : null,
    lighthouse: r.lighthouse,
    exposure: r.potential,
    catastrophic: r.catastrophic,
  }));
  const dnfRows: DnfRow[] = [
    ...failed.map((r) => ({ name: r.name, project_url: r.project_url, note: "DNF, the deployment did not respond" })),
    ...withheld.map((r) => ({
      name: r.name,
      project_url: r.project_url,
      note: r.blocked > 0
        ? "no score, a bot challenge blocked every check"
        : "no score, the app presented nothing to grade",
    })),
  ];
  const skipped = (entries ?? []).filter((e) => e.skip_reason);
  const total = (entries ?? []).length;

  return (
    <>
      <div className="page-head">
        <p className="back-link">
          <a href={`/events/${params.slug}`}>Back to {params.slug}</a>
        </p>
        <h1>{run.slug}</h1>
        <p className="page-lead">
          {ranked.length + gated.length} of {total} entries {run.mode}ly graded.
          {pending.length > 0 ? ` ${pending.length} still running.` : ""}
          {failed.length > 0 ? ` ${failed.length} could not be reached.` : ""}
          {withheld.length > 0 ? ` ${withheld.length} blocked before any check ran.` : ""}
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">The board</h2>
        <p className="section-intro">
          Default is sorted by lowest slop score. Lower is better. 
        </p>
        <p className="section-intro">
          Note that two apps can score the same and place differently, due to tiebreaks. Tiebreaks are
          in this order: lowest slop score --&gt; whether a catastrophic finding was found --&gt; worst 
          single finding --&gt; how much slop the app was exposed to --&gt; how many kinds of checks applied. 
        </p>
        {ranked.length === 0 ? (
          <p className="section-intro">Nothing has finished grading yet.</p>
        ) : (
          <>
            <BoardStats rows={boardRows} />
            <BoardTable rows={boardRows} dnf={dnfRows} />
          </>
        )}
      </section>

      {gated.length > 0 && (
        <section className="section">
          <h2 className="section-head">Not ranked</h2>
          <p className="section-intro">
            These carry a finding an attacker could use today, such as a served secret or an open
            backend. A low score does not make up for one, so they sit outside the ranking.
          </p>
          <div className="table-scroll">
            <table className="count-table">
              <thead><tr><th>submission</th><th>slop</th><th /></tr></thead>
              <tbody>
                {gated.map((r) => (
                  <tr key={r.project_url}>
                    <th scope="row">
                      <a href={r.project_url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                    </th>
                    <td>{fmt(r.slop)}</td>
                    <td>{r.grade_id ? <a href={`/grade/${r.grade_id}`}>report</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </>
  );
}
