import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import BoardTable, { type BoardRow } from "./BoardTable";
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
  gated: boolean;
};

function fmt(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function projectName(url: string): string {
  return url.replace(/\/+$/, "").split("/").pop() || url;
}

export default async function BoardPage({ params }: { params: { runId: string } }) {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=/events/${params.runId}`);

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
    ? await db.from("results").select("grade_id, slop_score, axis_slop, ranking, lighthouse_score").in("grade_id", ids)
    : { data: [] as { grade_id: string; slop_score: number; axis_slop: Record<string, number>; ranking: Record<string, unknown>; lighthouse_score: number | null }[] };

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
        gated: rk.has_catastrophe === true,
      };
    });

  // Graded, in order. Lower slop is better, and a gating finding sinks an app whatever it scored:
  // a leaked key with a low score is not a good entry, and a board that puts it first would be
  // telling an organizer the opposite of what happened.
  const ranked = rows
    .filter((r) => r.slop !== null && !r.gated)
    .sort((a, b) => (a.slop as number) - (b.slop as number));
  const gated = rows.filter((r) => r.gated);
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
    security: r.axes?.security ?? null,
    qa: r.axes?.qa ?? null,
    performance: r.axes?.performance ?? null,
    lighthouse: r.lighthouse,
    exposure: r.potential,
    cleaner: r.cleaner,
  }));
  const skipped = (entries ?? []).filter((e) => e.skip_reason);
  const total = (entries ?? []).length;

  return (
    <>
      <div className="page-head">
        <p className="back-link">
          <a href="/events">Back to events</a>
        </p>
        <h1>{run.slug}</h1>
        <p className="page-lead">
          {ranked.length + gated.length} of {total} entries {run.mode}ly graded.
          {pending.length > 0 ? ` ${pending.length} still running.` : ""}
          {failed.length > 0 ? ` ${failed.length} could not be reached.` : ""}
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
            <BoardTable rows={boardRows} />
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

      {failed.length > 0 && (
        <section className="section">
          <h2 className="section-head">Could not be reached</h2>
          <p className="section-intro">
            Sloptic cannot access these domains as of grade time. Possible reasons include: expired domain, 
            expired free tier, disabled build, WAF challenge on our end, etc.
          </p>
          <div className="table-scroll">
            <table className="count-table">
              <thead><tr><th>submission</th></tr></thead>
              <tbody>
                {failed.map((r) => (
                  <tr key={r.project_url}>
                    <th scope="row">
                      <a href={r.project_url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                    </th>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="method" data-tone="limits">
        <h2>What this board covers</h2>
        <p>
          {total} entries were in the gallery and {skipped.length} could not be graded. Most events
          lose entries to submissions that link only to a repository which is worth mentioning.
        </p>
        <div className="cta-row">
          <a className="button secondary" href="/events">Back to events</a>
        </div>
      </div>
    </>
  );
}
