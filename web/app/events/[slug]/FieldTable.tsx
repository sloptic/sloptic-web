"use client";

import { useState } from "react";

export type FieldEntry = {
  project_url: string;
  skip_reason: string | null;
  grade_id: string | null;
  status: string | null;
};

const PAGE = 20;

function projectName(url: string): string {
  return url.replace(/\/+$/, "").split("/").pop() || url;
}

/** The resolved field for one run: every submission and what became of it.
 *
 *  This is the staging view, so it shows what WILL be graded as well as what was. The board only
 *  ever shows entries that produced a score, which is the wrong list to check before authorising a
 *  run over other people's apps. */
export default function FieldTable({ entries }: { entries: FieldEntry[] }) {
  const [page, setPage] = useState(0);
  const [skippedOnly, setSkippedOnly] = useState(false);

  const rows = skippedOnly ? entries.filter((e) => e.skip_reason) : entries;
  const last = Math.max(0, Math.ceil(rows.length / PAGE) - 1);
  const from = Math.min(page, last) * PAGE;
  const shown = rows.slice(from, from + PAGE);

  return (
    <details className="check-detail field-block">
      <summary>the field ({entries.length})</summary>

      <label className="field-filter">
        <input
          type="checkbox"
          checked={skippedOnly}
          onChange={(e) => {
            setSkippedOnly(e.target.checked);
            setPage(0);
          }}
        />
        only what was skipped
      </label>

      <div className="table-scroll">
        <table className="count-table">
          <thead>
            <tr>
              <th>submission</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.project_url}>
                <th scope="row">
                  <a href={e.project_url} target="_blank" rel="noopener noreferrer">
                    {projectName(e.project_url)}
                  </a>
                </th>
                <td className="band-note">
                  {e.skip_reason
                    ? `skipped (${e.skip_reason})`
                    : e.status === "running"
                      ? "grading now"
                      : e.status === "queued"
                        ? "waiting"
                        : e.status === "failed"
                          ? "did not respond"
                          : e.grade_id
                            ? <a href={`/grade/${e.grade_id}`}>report</a>
                            : "will be graded"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE && (
        <div className="pager">
          <button className="link-button" type="button" disabled={from === 0} onClick={() => setPage(Math.min(page, last) - 1)}>
            previous
          </button>
          <span>
            {from + 1} to {Math.min(from + PAGE, rows.length)} of {rows.length}
          </span>
          <button className="link-button" type="button" disabled={from + PAGE >= rows.length} onClick={() => setPage(Math.min(page, last) + 1)}>
            next
          </button>
        </div>
      )}
    </details>
  );
}
