"use client";

import { useState } from "react";
import type { RecoveryMarks } from "@/lib/grades";

/** The recovery letters, same rule as the field's. The score cell shows them right of the number;
 *  N and P render only once no retry is pending (B owns the cell while a pass is still booked). */
function RecoverySup({ marks }: { marks?: RecoveryMarks | null }) {
  if (!marks) return null;
  return (
    <>
      {!marks.retry && marks.none && (
        <sup className="prov-mark" title="The retries recovered nothing: a challenge held every time.">
          N
        </sup>
      )}
      {!marks.retry && marks.partial && (
        <sup className="prov-mark" title="The retries recovered some blocked checks, not all.">
          P
        </sup>
      )}
      {!marks.retry && marks.full && (
        <sup className="prov-mark" title="The retries recovered every blocked check.">
          F
        </sup>
      )}
      {marks.limited && (
        <sup className="prov-mark" title="Limited engagement: fewer than 40 checks applied.">
          L
        </sup>
      )}
    </>
  );
}

export type BoardRow = {
  name: string;
  project_url: string;
  grade_id: string | null;
  slop: number;
  /** slop as a share of what the app was exposed to, so a big app and a small one compare. */
  ratio: number | null;
  lighthouse: number | null;
  exposure: number | null;
  /** Findings that gate absolutely. Null when the grade predates the field. */
  catastrophic: number | null;
  /** A challenge-blocked check is being retried, so this score can still move. Shown as a
   *  superscript B, explained once under the table. N and P say what the passes achieved once
   *  they are done; L marks the grader's limited-engagement note. */
  provisional: boolean;
  marks: RecoveryMarks;
};

/** Graded but produced no score: unreachable, or reached but blocked before any check ran. Kept in
 *  the table under everything else, because an organizer needs to see WHICH entries produced nothing
 *  and WHY, and a separate section below the fold buries that. `note` carries the reason, `marks`
 *  the recovery letters when the no-score row is a challenge story. */
export type DnfRow = { name: string; project_url: string; note: string; marks?: RecoveryMarks | null };

type Key = "rank" | "name" | "slop" | "ratio" | "lighthouse" | "exposure" | "catastrophic";

const PAGE = 25;

function fmt(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Columns, and which way is "good" for each, so a first click sorts the useful way. Slop ascending
 *  puts the best first; Lighthouse and percentile descending do the same, because higher is better
 *  there. Getting this wrong means every column needs two clicks to be useful. */
const COLUMNS: { key: Key; label: string; asc: boolean }[] = [
  { key: "rank", label: "#", asc: true },
  { key: "name", label: "submission", asc: true },
  { key: "slop", label: "slop", asc: true },
  { key: "ratio", label: "ratio", asc: true },
  { key: "exposure", label: "exposure", asc: false },
  { key: "lighthouse", label: "lighthouse", asc: false },
  { key: "catastrophic", label: "catastrophic", asc: true },
];

export default function BoardTable({ rows, dnf }: { rows: BoardRow[]; dnf: DnfRow[] }) {
  const [sort, setSort] = useState<{ key: Key; asc: boolean }>({ key: "rank", asc: true });
  const [page, setPage] = useState(0);

  // The rank is the board's own order, so it is kept as the identity of a row rather than recomputed
  // per sort. Sorting by performance should not renumber anyone.
  const withRank = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  const sorted = [...withRank].sort((a, b) => {
    const dir = sort.asc ? 1 : -1;
    if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
    const av = a[sort.key as keyof typeof a] as number | null;
    const bv = b[sort.key as keyof typeof b] as number | null;
    // Missing values sink, whichever way the column is sorted: an app with no Lighthouse score is
    // not the best performer.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * dir;
  });

  const last = Math.max(0, Math.ceil(sorted.length - 1) / PAGE === 0 ? 0 : Math.ceil(sorted.length / PAGE) - 1);
  const from = page * PAGE;
  const shown = sorted.slice(from, from + PAGE);

  function click(key: Key) {
    setPage(0);
    setSort((s) =>
      s.key === key
        ? { key, asc: !s.asc }
        : { key, asc: COLUMNS.find((c) => c.key === key)?.asc ?? true }
    );
  }

  return (
    <>
      <div className="table-scroll">
        <table className="count-table board-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.asc ? "ascending" : "descending") : "none"}>
                  <button type="button" className="col-sort" onClick={() => click(c.key)}>
                    {c.label}
                    <span className="col-arrow" aria-hidden>
                      {sort.key === c.key ? (sort.asc ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.project_url}>
                <td>{r.rank}</td>
                <th scope="row">
                  <a href={r.project_url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                </th>
                <td>
                  {fmt(r.slop)}
                  {r.provisional && (
                    <sup className="prov-mark" title="A challenge-blocked check is being retried. The score may change.">
                      B
                    </sup>
                  )}
                  <RecoverySup marks={r.marks} />
                </td>
                <td>{r.ratio === null ? "-" : `${r.ratio.toFixed(1)}%`}</td>
                <td>{fmt(r.exposure)}</td>
                <td>{r.lighthouse === null ? "-" : r.lighthouse}</td>
                <td>{r.catastrophic === null ? "-" : r.catastrophic}</td>
                <td>{r.grade_id ? <a href={`/grade/${r.grade_id}`}>report</a> : null}</td>
              </tr>
            ))}
          </tbody>
          {dnf.length > 0 && page >= last && (
            <tbody className="dnf-rows">
              {dnf.map((d) => (
                <tr key={d.project_url}>
                  <td>-</td>
                  <th scope="row">
                    <a href={d.project_url} target="_blank" rel="noopener noreferrer">{d.name}</a>
                  </th>
                  <td colSpan={5}>
                    {d.note}
                    <RecoverySup marks={d.marks} />
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {rows.some((r) => r.provisional) && (
        <p className="fineprint prov-note">B: a challenge-blocked check is being retried. The score may change.</p>
      )}
      {rows.some((r) => !r.provisional && (r.marks.none || r.marks.partial || r.marks.full || r.marks.limited)) && (
        <p className="fineprint prov-note">
          N: the retries recovered nothing. P: partially recovered. F: fully recovered. L: limited engagement.
        </p>
      )}
      {sorted.length > PAGE && (
        <div className="pager">
          <button className="link-button" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            previous
          </button>
          <span>
            {from + 1} to {Math.min(from + PAGE, sorted.length)} of {sorted.length}
          </span>
          <button className="link-button" type="button" disabled={page >= last} onClick={() => setPage(page + 1)}>
            next
          </button>
        </div>
      )}
    </>
  );
}
