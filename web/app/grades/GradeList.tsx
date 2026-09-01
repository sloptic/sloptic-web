"use client";

import { useCallback, useEffect, useState } from "react";
import { forgetGrades, readHistory, rememberGrade } from "@/lib/history";
import { ANON_REPORT_DAYS, daysUntil, reportExpiresAt } from "@/lib/retention";
import { ordinal, type GradeSummary } from "@/lib/grades";

const STATUS_TEXT: Record<GradeSummary["status"], string> = {
  queued: "waiting",
  running: "grading",
  done: "",
  failed: "did not finish",
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

function keepText(g: GradeSummary): string {
  if (g.status !== "done") return "";
  if (g.claimed) return "kept";
  const when = reportExpiresAt(g.finished_at, false);
  if (!when) return "";
  const days = daysUntil(when);
  return days === 0 ? "expires today" : `expires in ${days}d`;
}

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export default function GradeList({ signedIn }: { signedIn: boolean }) {
  const [grades, setGrades] = useState<GradeSummary[] | null>(null);
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const history = readHistory();
    setLocalIds(history.map((e) => e.id));

    // Two sources, merged: what this BROWSER remembers submitting, and what the ACCOUNT owns.
    // Neither is a superset. An account carries grades run on another machine, a browser carries
    // ones never claimed.
    let failed = false;
    const [mine, local] = await Promise.all([
      signedIn
        ? getJson("/api/grades").catch(() => {
            failed = true;
            return { grades: [] };
          })
        : Promise.resolve({ grades: [] }),
      history.length
        ? postJson("/api/grades/lookup", { ids: history.map((e) => e.id) }).catch(() => {
            failed = true;
            return { grades: [] };
          })
        : Promise.resolve({ grades: [] }),
    ]);

    const byId = new Map<string, GradeSummary>();
    for (const g of [...(local.grades ?? []), ...(mine.grades ?? [])] as GradeSummary[]) {
      byId.set(g.id, g);
    }

    // Only forget a local entry when the server ANSWERED and did not have it, which means the grade
    // was deleted or swept. A failed lookup is not evidence of absence, and treating it as one would
    // let one bad response permanently erase a browser's history.
    if (!failed && history.length) {
      const alive = new Set(byId.keys());
      const stale = history.map((e) => e.id).filter((id) => !alive.has(id));
      if (stale.length) forgetGrades(stale);
    }

    setLoadFailed(failed);
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
      const data = await postJson("/api/grades/claim", { ids: unclaimed.map((g) => g.id) });
      setNote(`Saved ${data.claimed.length} to your account.`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save them.");
    } finally {
      setClaiming(false);
    }
  }

  /** Add a report this browser does not know about, by its link. Requires nothing but the link,
   *  which is already the whole of the access control, so this grants nothing new. It is the way
   *  back from a bookmark, another device, or a tab closed before the list existed. */
  async function addByLink(e: React.FormEvent) {
    e.preventDefault();
    const match = link.match(UUID);
    if (!match) {
      setNote("That is not a report link.");
      return;
    }
    setAdding(true);
    setNote(null);
    try {
      const data = await postJson("/api/grades/lookup", { ids: [match[0]] });
      const found = (data.grades ?? [])[0] as GradeSummary | undefined;
      if (!found) {
        setNote("No report at that link. It may have been deleted.");
        return;
      }
      rememberGrade({ id: found.id, origin: found.origin, at: found.submitted_at });
      setLink("");
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setAdding(false);
    }
  }

  const addForm = (
    <form className="add-report" onSubmit={addByLink}>
      <label htmlFor="add-report">Add a report by its link</label>
      <div className="add-report-row">
        <input
          id="add-report"
          type="text"
          value={link}
          onChange={(ev) => setLink(ev.target.value)}
          placeholder="https://sloptic.org/grade/..."
          spellCheck={false}
        />
        <button className="button secondary" type="submit" disabled={adding || !link.trim()}>
          {adding ? "adding..." : "add"}
        </button>
      </div>
    </form>
  );

  async function remove(g: GradeSummary) {
    if (!window.confirm(`Delete the grade for ${g.origin}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/grade/${g.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete it.");
      forgetGrades([g.id]);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not delete it.");
    }
  }

  if (grades === null) return <p className="section-intro">Looking...</p>;

  if (grades.length === 0) {
    return (
      <section className="section attached">
        {/* Never report "nothing" when the answer is "could not tell". */}
        <p className="section-intro">
          {loadFailed
            ? "Could not load your grades. Reload the page."
            : "Nothing here yet. A grade you run shows up here, and stays at its own link."}
        </p>
        {note ? <p className="section-intro">{note}</p> : null}
        {addForm}
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="section attached">
      {loadFailed ? (
        <p className="section-intro">Some grades could not be loaded. This list may be short.</p>
      ) : null}
      {note ? <p className="section-intro">{note}</p> : null}

      {unclaimed.length > 0 ? (
        <div className="callout" data-tone={signedIn ? undefined : "warn"}>
          <p className="callout-label">{signedIn ? "not saved" : "this browser only"}</p>
          <p>
            {unclaimed.length === 1 ? "One report is" : `${unclaimed.length} reports are`} held by
            this browser alone. {unclaimed.length === 1 ? "It is" : "They are"} deleted{" "} after {" "}
            {ANON_REPORT_DAYS} days.{" "}
            {signedIn ? "Save them to keep them." : "Sign in to keep them."}
          </p>
          <div className="cta-row">
            {signedIn ? (
              <button className="button" type="button" onClick={claimAll} disabled={claiming}>
                {claiming ? "saving..." : "Save to my account"}
              </button>
            ) : (
              <a className="button" href="/signin?next=/grades">
                Sign in
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
              <th>graded</th>
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
                <td className="grade-mode">{g.mode}</td>
                <td>{g.status === "done" ? fmtScore(g.slop_score) : STATUS_TEXT[g.status]}</td>
                <td>{g.cleaner_than_pct === null ? "-" : ordinal(Math.round(g.cleaner_than_pct))}</td>
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

      {addForm}

      <p className="section-intro fineprint">
        A report opens for anyone holding its link, who can also delete it. Treat the link as private.
      </p>
    </section>
  );
}
