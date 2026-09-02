import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ordinal } from "@/lib/grades";

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
    ? await db.from("results").select("grade_id, slop_score, axis_slop, ranking").in("grade_id", ids)
    : { data: [] as { grade_id: string; slop_score: number; axis_slop: Record<string, number>; ranking: Record<string, unknown> }[] };

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
  const pending = rows.filter((r) => r.slop === null && !r.gated);
  const skipped = (entries ?? []).filter((e) => e.skip_reason);
  const total = (entries ?? []).length;

  return (
    <>
      <div className="page-head">
        <h1>{run.slug}</h1>
        <p className="page-lead">
          {ranked.length + gated.length} of {total} entries graded on the {run.mode} checks.
          {pending.length > 0 ? ` ${pending.length} still running.` : ""}
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">The board</h2>
        <p className="section-intro">
          Sorted by slop score, lowest first. The percentile compares each app against the frozen
          population for this battery, so it does not depend on who else entered this event.
        </p>
        <p className="section-intro">
          Two apps can score the same and place differently. The exposure column is why: it is how
          much slop the app was open to across the checks that applied, and surviving more of it ranks
          higher at the same score. Each report shows the full breakdown.
        </p>
        {ranked.length === 0 ? (
          <p className="section-intro">Nothing has finished grading yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="count-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>submission</th>
                  <th>slop</th>
                  <th>security</th>
                  <th>qa</th>
                  <th>performance</th>
                  <th>exposure</th>
                  <th>percentile</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.project_url}>
                    <td>{i + 1}</td>
                    <th scope="row">
                      <a href={r.project_url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                    </th>
                    <td>{fmt(r.slop)}</td>
                    <td>{fmt(r.axes?.security ?? null)}</td>
                    <td>{fmt(r.axes?.qa ?? null)}</td>
                    <td>{fmt(r.axes?.performance ?? null)}</td>
                    <td>{fmt(r.potential)}</td>
                    <td>{r.cleaner === null ? "-" : ordinal(Math.round(r.cleaner))}</td>
                    <td>{r.grade_id ? <a href={`/grade/${r.grade_id}`}>report</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      <div className="method" data-tone="limits">
        <h2>What this board covers</h2>
        <p>
          {total} entries were in the gallery and {skipped.length} could not be graded. Most events
          lose entries to submissions that link only to a repository, which is worth a line in your
          rules next time.
        </p>
        <p>
          Every entry here ran the same {run.mode} battery, so the scores compare. A{" "}
          {run.mode === "passive" ? "passive" : "full"} grade is its own measurement and does not
          compare to the other one.
          {run.override ? " This run skipped the ownership check, so it is not an authorized board." : ""}
          {run.gallery_complete === false
            ? " Devpost stopped answering while we read the gallery, so this is not the whole field."
            : ""}
        </p>
        <div className="cta-row">
          <a className="button secondary" href="/events">Your events</a>
        </div>
      </div>
    </>
  );
}
