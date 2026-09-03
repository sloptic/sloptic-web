"use client";

import { useState } from "react";

export type FieldEntry = {
  project_url: string;
  skip_reason: string | null;
  grade_id: string | null;
  status: string | null;
  progress: { done?: number; total?: number; label?: string } | null;
};

const PAGE = 20;

/** Sort order for the status column, which is not alphabetical: what is happening now comes first,
 *  then what is about to, then what is finished, then what never will. Sorting the words instead
 *  would put "did not respond" above "grading now", which is the opposite of useful. */
const STATUS_RANK: Record<string, number> = {
  running: 0,
  queued: 1,
  pending: 2,
  done: 3,
  failed: 4,
  skipped: 5,
};

function statusKey(e: FieldEntry): number {
  if (e.skip_reason) return STATUS_RANK.skipped;
  if (e.status && e.status in STATUS_RANK) return STATUS_RANK[e.status];
  return STATUS_RANK.pending;
}

function projectName(url: string): string {
  return url.replace(/\/+$/, "").split("/").pop() || url;
}

/** The resolved field for one run: every submission and what became of it.
 *
 *  This is the staging view, so it shows what WILL be graded as well as what was. The board only
 *  ever shows entries that produced a score, which is the wrong list to check before authorising a
 *  run over other people's apps. */
export default function FieldTable({
  entries,
  runId,
  canGrade,
  onGraded,
}: {
  entries: FieldEntry[];
  runId?: string;
  /** Whether one-at-a-time grading is offered. Off once the run is finished. */
  canGrade?: boolean;
  onGraded?: () => void;
}) {
  const [queuing, setQueuing] = useState<string | null>(null);

  async function gradeOne(projectUrl: string) {
    if (!runId) return;
    setQueuing(projectUrl);
    try {
      await fetch("/api/events/run/grade-one", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, projectUrl }),
      });
      onGraded?.();
    } finally {
      setQueuing(null);
    }
  }

  const [page, setPage] = useState(0);
  // Two boxes over one field, so they read as a union: tick nothing and you see everything, tick
  // both and you also see everything, since eligible and skipped are the two halves. A pair of
  // checkboxes that can select nothing at all would just be a way to empty the table.
  const [showEligible, setShowEligible] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [sort, setSort] = useState<{ key: "name" | "status"; asc: boolean }>({ key: "name", asc: true });

  const filtered =
    showEligible === showSkipped
      ? entries
      : entries.filter((e) => (showSkipped ? e.skip_reason : !e.skip_reason));
  const rows = [...filtered].sort((a, b) => {
    const dir = sort.asc ? 1 : -1;
    if (sort.key === "name") return projectName(a.project_url).localeCompare(projectName(b.project_url)) * dir;
    return (statusKey(a) - statusKey(b)) * dir ||
      projectName(a.project_url).localeCompare(projectName(b.project_url));
  });

  function click(key: "name" | "status") {
    setPage(0);
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));
  }
  const last = Math.max(0, Math.ceil(rows.length / PAGE) - 1);
  const from = Math.min(page, last) * PAGE;
  const shown = rows.slice(from, from + PAGE);

  return (
    <details className="check-detail field-block">
      <summary>the field ({entries.length})</summary>

      <div className="field-filters">
        <label className="field-filter">
          <input
            type="checkbox"
            checked={showEligible}
            onChange={(e) => {
              setShowEligible(e.target.checked);
              setPage(0);
            }}
          />
          grading eligible ({entries.filter((e) => !e.skip_reason).length})
        </label>
        <label className="field-filter">
          <input
            type="checkbox"
            checked={showSkipped}
            onChange={(e) => {
              setShowSkipped(e.target.checked);
              setPage(0);
            }}
          />
          skipped ({entries.filter((e) => e.skip_reason).length})
        </label>
      </div>

      <div className="table-scroll">
        <table className="count-table">
          <thead>
            <tr>
              {(["name", "status"] as const).map((k) => (
                <th key={k} aria-sort={sort.key === k ? (sort.asc ? "ascending" : "descending") : "none"}>
                  <button type="button" className="col-sort" onClick={() => click(k)}>
                    {k === "name" ? "submission" : "status"}
                    <span className="col-arrow" aria-hidden>
                      {sort.key === k ? (sort.asc ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              ))}
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
                  {e.skip_reason ? (
                    `skipped (${e.skip_reason})`
                  ) : e.status === "running" ? (
                    // The entry carries its own progress while it runs, so a long field reads as a
                    // set of things happening rather than one number that moves occasionally.
                    <span className="entry-progress">
                      <span className="progress-track" aria-hidden>
                        <span
                          className="progress-fill"
                          style={{
                            width:
                              e.progress?.total && e.progress?.done !== undefined
                                ? `${Math.min(100, Math.round((e.progress.done / e.progress.total) * 100))}%`
                                : "8%",
                          }}
                        />
                      </span>
                      <span className="entry-progress-label">
                        {e.progress?.label ??
                          (e.progress?.total !== undefined && e.progress?.done !== undefined
                            ? `${e.progress.done} of ${e.progress.total} checks`
                            : "starting")}
                      </span>
                    </span>
                  ) : e.status === "queued" ? (
                    "waiting"
                  ) : e.status === "failed" ? (
                    "did not respond"
                  ) : e.grade_id ? (
                    <a href={`/grade/${e.grade_id}`}>report</a>
                  ) : canGrade && runId ? (
                    // The drip feed: grade this one now, which an organizer does as each team
                    // finishes demoing so active traffic never lands on an app a judge is watching.
                    <button
                      className="link-button"
                      type="button"
                      disabled={queuing === e.project_url}
                      onClick={() => void gradeOne(e.project_url)}
                    >
                      {queuing === e.project_url ? "queuing..." : "grade now"}
                    </button>
                  ) : (
                    "will be graded"
                  )}
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
