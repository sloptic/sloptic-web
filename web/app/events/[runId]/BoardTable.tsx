"use client";

import { useState } from "react";
import { ordinal } from "@/lib/grades";

export type BoardRow = {
  name: string;
  project_url: string;
  grade_id: string | null;
  slop: number;
  security: number | null;
  qa: number | null;
  performance: number | null;
  lighthouse: number | null;
  exposure: number | null;
  cleaner: number | null;
};

type Key = "rank" | "name" | "slop" | "security" | "qa" | "performance" | "lighthouse" | "exposure" | "cleaner";

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
  { key: "security", label: "security", asc: true },
  { key: "qa", label: "qa", asc: true },
  { key: "performance", label: "performance", asc: true },
  { key: "lighthouse", label: "lighthouse", asc: false },
  { key: "exposure", label: "exposure", asc: false },
  { key: "cleaner", label: "percentile", asc: false },
];

export default function BoardTable({ rows }: { rows: BoardRow[] }) {
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
                <td>{fmt(r.slop)}</td>
                <td>{fmt(r.security)}</td>
                <td>{fmt(r.qa)}</td>
                <td>{fmt(r.performance)}</td>
                <td>{r.lighthouse === null ? "-" : r.lighthouse}</td>
                <td>{fmt(r.exposure)}</td>
                <td>{r.cleaner === null ? "-" : ordinal(Math.round(r.cleaner))}</td>
                <td>{r.grade_id ? <a href={`/grade/${r.grade_id}`}>report</a> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
