"use client";

import { useCallback, useEffect, useState } from "react";
import { forgetGrades, readHistory } from "@/lib/history";
import { ANON_REPORT_DAYS, daysUntil, reportExpiresAt } from "@/lib/retention";
import type { GradeSummary } from "@/lib/grades";

const STATUS_TEXT: Record<GradeSummary["status"], string> = {
  queued: "waiting",
  running: "grading",
  done: "",
  failed: "did not finish",
};

function fmtScore(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** What happens to this report, said plainly. The whole point of an account is that this line
 *  changes, so it is worth stating on every row rather than once in a footnote. */
function keepText(g: GradeSummary): string {
  if (g.status !== "done") return "";
  if (g.claimed) return "kept with your account";
  const when = reportExpiresAt(g.finished_at, false);
  if (!when) return "";
  const days = daysUntil(when);
  if (days === 0) return "expires today";
  return `expires in ${days} day${days === 1 ? "" : "s"}`;
}

export default function GradeList({ signedIn }: { signedIn: boolean }) {
  const [grades, setGrades] = useState<GradeSummary[] | null>(null);
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const history = readHistory();
    setLocalIds(history.map((e) => e.id));

    // Two sources, merged: what this BROWSER remembers submitting, and what the ACCOUNT owns. They
    // overlap for a signed-in user who has claimed, and neither is a superset of the other, since
    // an account carries grades run on another machine and a browser carries ones never claimed.
    const [mine, local] = await Promise.all([
      signedIn
        ? fetch("/api/grades", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : { grades: [] }))
            .catch(() => ({ grades: [] }))
        : Promise.resolve({ grades: [] }),
      history.length
        ? fetch("/api/grades/lookup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids: history.map((e) => e.id) }),
            cache: "no-store",
          })
            .then((r) => (r.ok ? r.json() : { grades: [] }))
            .catch(() => ({ grades: [] }))
        : Promise.resolve({ grades: [] }),
    ]);

    const byId = new Map<string, GradeSummary>();
    for (const g of [...(local.grades ?? []), ...(mine.grades ?? [])] as GradeSummary[]) {
      byId.set(g.id, g);
    }

    // A local entry with no row behind it is a grade that has already been deleted or swept, so
    // stop remembering it rather than rendering a link to a 404.
    const alive = new Set(byId.keys());
    const stale = history.map((e) => e.id).filter((id) => !alive.has(id));
    if (stale.length) forgetGrades(stale);

    setGrades(
      [...byId.values()].sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))
    );
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const unclaimed = (grades ?? []).filter((g) => !g.claimed && localIds.includes(g.id));

  async function claimAll() {
    setClaiming(true);
    setNote(null);
    try {
      const res = await fetch("/api/grades/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: unclaimed.map((g) => g.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save them.");
      setNote(`Saved ${data.claimed.length} to your account.`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save them.");
    } finally {
      setClaiming(false);
    }
  }

  async function remove(g: GradeSummary) {
    if (!window.confirm(`Delete the grade for ${g.origin}? This cannot be undone.`)) return;
    const res = await fetch(`/api/grade/${g.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNote(data.error || "Could not delete it.");
      return;
    }
    forgetGrades([g.id]);
    await load();
  }

  if (grades === null) return <p className="section-intro">Looking for your grades...</p>;

  if (grades.length === 0) {
    return (
      <section className="section">
        <p className="section-intro">
          Nothing here yet. A grade you run shows up on this page, and the report itself stays at its
          own link.
        </p>
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      {note ? <p className="section-intro">{note}</p> : null}

      {unclaimed.length > 0 ? (
        <div className="callout" data-tone={signedIn ? undefined : "warn"}>
          <p className="callout-label">{signedIn ? "not saved yet" : "this browser only"}</p>
          <p>
            {unclaimed.length === 1 ? "One grade is" : `${unclaimed.length} grades are`} remembered by
            this browser alone, and {unclaimed.length === 1 ? "its report" : "their reports"} will be
            deleted {ANON_REPORT_DAYS} days after {unclaimed.length === 1 ? "it ran" : "they ran"}.{" "}
            {signedIn
              ? "Saving them to your account keeps them, and makes them reachable from anywhere you sign in."
              : "Signing in keeps them, and makes them reachable from anywhere you sign in."}
          </p>
          <div className="cta-row">
            {signedIn ? (
              <button className="button" type="button" onClick={claimAll} disabled={claiming}>
                {claiming ? "saving..." : "Save them to my account"}
              </button>
            ) : (
              <a className="button" href="/signin?next=/grades">
                Sign in to keep them
              </a>
            )}
          </div>
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="grade-table">
          <thead>
            <tr>
              <th>app</th>
              <th>slop</th>
              <th>percentile</th>
              <th>run</th>
              <th>report</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.id}>
                <th scope="row">
                  <a href={`/grade/${g.id}`}>{g.origin.replace(/^https?:\/\//, "")}</a>
                </th>
                <td>{g.status === "done" ? fmtScore(g.slop_score) : STATUS_TEXT[g.status]}</td>
                <td>{g.percentile === null ? "-" : `${Math.round(g.percentile)}`}</td>
                <td>{fmtDate(g.submitted_at)}</td>
                <td className="keep">{keepText(g)}</td>
                <td>
                  <button className="link-button" type="button" onClick={() => void remove(g)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="section-intro fineprint">
        A report also stays at its own link, which is the only thing that opens it, so treat that link
        as private. Anyone holding it can read the report and can delete it.
      </p>
    </section>
  );
}
