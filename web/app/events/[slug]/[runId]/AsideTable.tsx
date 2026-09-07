"use client";

import { useEffect, useState } from "react";
import RecoverySup from "@/app/RecoverySup";
import type { RecoveryMarks } from "@/lib/grades";

/** The three sections beside the board: didn't finish, nothing to grade, not ranked.
 *
 *  One component because they are one thing wearing three labels. Each is a list of entries that
 *  produced no placement, each names the submission and says why, and each was an unpaginated,
 *  unsortable dump. On a real field that is the failure mode the board itself already fixed: a
 *  treehacks-sized event puts a hundred rows on the page with no way to find one, and "which of
 *  these is mine" becomes ctrl-F.
 *
 *  It renders a table rather than the quiet list these used to be, because sorting needs somewhere
 *  to click, and a column header is the place a reader already looks for it.
 *
 *  Columns follow the data rather than a prop: a section with reasons gets a reason column, one with
 *  scores gets a score column, one with reports gets the links. Three call sites configuring the
 *  same component three ways is how the three of them drifted apart in the first place.
 */

export type AsideRow = {
  name: string;
  project_url: string;
  /** Why this entry is here: the DNF note, or the skip reason. Empty where the section has scores. */
  reason?: string;
  marks?: RecoveryMarks | null;
  /** Not-ranked rows carry a real score; it is the ranking they are outside of, not the grading. */
  slop?: number | null;
  grade_id?: string | null;
};

const PAGE = 25;

type Key = "name" | "reason" | "slop";

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export default function AsideTable({
  rows,
  reasonLabel = "why",
}: {
  rows: AsideRow[];
  /** What the reason column is called here: "what happened" reads wrong over skip reasons. */
  reasonLabel?: string;
}) {
  // Alphabetical to begin with. The incoming order is whatever the page happened to concatenate,
  // which is not an order a reader can predict, and "find my submission" is the thing being asked of
  // these lists far more often than any ranking is.
  const [sort, setSort] = useState<{ key: Key; asc: boolean }>({ key: "name", asc: true });
  const [page, setPage] = useState(0);

  const hasReason = rows.some((r) => r.reason);
  const hasSlop = rows.some((r) => r.slop !== undefined && r.slop !== null);
  const hasReport = rows.some((r) => r.grade_id);

  const columns: { key: Key; label: string; asc: boolean }[] = [
    { key: "name", label: "submission", asc: true },
    ...(hasReason ? [{ key: "reason" as Key, label: reasonLabel, asc: true }] : []),
    // Ascending first, like the board: on a slop score lower is better, so the useful first click
    // is the one that puts the least bad at the top.
    ...(hasSlop ? [{ key: "slop" as Key, label: "slop", asc: true }] : []),
  ];

  const sorted = [...rows].sort((a, b) => {
    const dir = sort.asc ? 1 : -1;
    if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
    if (sort.key === "reason") {
      // Reasons are a small vocabulary rather than free text, so sorting by them groups the field by
      // what went wrong, which is the second question after "where is mine". Ties fall back to the
      // name so the grouping is stable and does not shuffle under a re-render.
      const c = (a.reason ?? "").localeCompare(b.reason ?? "") * dir;
      return c !== 0 ? c : a.name.localeCompare(b.name);
    }
    const av = a.slop ?? null;
    const bv = b.slop ?? null;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;      // a missing measurement is not a good one, either way up
    if (bv === null) return -1;
    return (av - bv) * dir;
  });

  const last = Math.max(0, Math.ceil(sorted.length / PAGE) - 1);
  const from = Math.min(page, last) * PAGE;
  const shown = sorted.slice(from, from + PAGE);
  // The list shrinks under a live refresh (a retry recovers a score and the row leaves for the
  // board), so a page that no longer exists has to fall back rather than render empty.
  useEffect(() => {
    if (page > last) setPage(last);
  }, [page, last]);

  function click(key: Key) {
    setPage(0);
    setSort((s) =>
      s.key === key ? { key, asc: !s.asc } : { key, asc: columns.find((c) => c.key === key)?.asc ?? true }
    );
  }

  if (rows.length === 0) return null;

  return (
    <>
      <div className="table-scroll">
        <table className="count-table aside-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.asc ? "ascending" : "descending") : "none"}>
                  <button type="button" className="col-sort" onClick={() => click(c.key)}>
                    {c.label}
                    <span className="col-arrow" aria-hidden>
                      {sort.key === c.key ? (sort.asc ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              ))}
              {hasReport && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.project_url}>
                <th scope="row">
                  <a href={r.project_url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                </th>
                {hasReason && (
                  <td className="aside-reason">
                    {r.reason}
                    <RecoverySup marks={r.marks} />
                  </td>
                )}
                {hasSlop && <td>{fmt(r.slop)}</td>}
                {hasReport && <td>{r.grade_id ? <a href={`/grade/${r.grade_id}`}>report</a> : null}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE && (
        <div className="pager">
          <button className="link-button" type="button" disabled={page === 0} onClick={() => setPage(0)}>
            first
          </button>
          <button className="link-button" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            previous
          </button>
          <span>
            {from + 1} to {Math.min(from + PAGE, sorted.length)} of {sorted.length}
          </span>
          <button className="link-button" type="button" disabled={page >= last} onClick={() => setPage(page + 1)}>
            next
          </button>
          <button className="link-button" type="button" disabled={page >= last} onClick={() => setPage(last)}>
            last
          </button>
        </div>
      )}
    </>
  );
}
