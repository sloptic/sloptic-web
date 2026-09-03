"use client";

import { useEffect, useState } from "react";

export type FieldEntry = {
  project_url: string;
  skip_reason: string | null;
  grade_id: string | null;
  status: string | null;
  /** The running grade's live progress: how many checks have run of the battery. */
  progress: { done?: number; total?: number; label?: string } | null;
  /** A challenge-blocked check is being retried, so the report's score is provisional. */
  retrying?: boolean;
};

/** The status cell for a grade that is running: a real progress bar (checks run of the battery) and
 *  the count as a link into that grade's own page. Falls back to an indeterminate bar and "starting"
 *  for the brief window before the first count arrives (discovery, before the probe loop). */
function RunningCell({ gradeId, progress }: { gradeId: string | null; progress: FieldEntry["progress"] }) {
  const done = progress?.done;
  const total = progress?.total;
  const known = typeof total === "number" && total > 0 && typeof done === "number";
  const pct = known ? Math.min(100, Math.round((done! / total!) * 100)) : null;
  const text = known ? `${done} of ${total}` : "starting";
  return (
    <span className="entry-progress">
      <span className={known ? "progress-track" : "progress-track indeterminate"} aria-hidden>
        <span className="progress-fill" style={known ? { width: `${pct}%` } : undefined} />
      </span>
      <span className="entry-progress-label">
        {gradeId ? <a href={`/grade/${gradeId}`}>{text}</a> : text}
      </span>
    </span>
  );
}

const PAGE = 20;

/** Sort order for the status column, which is not alphabetical: sorting the words would put "did
 *  not respond" above "in progress".
 *
 *  What is running comes above what has a report, even though the reports are what you came to
 *  read. A page holds 20, so once 20 apps have finished, reports on top would push the handful
 *  still running onto page 2 and the drip feed would look like nothing was happening. */
const STATUS_RANK: Record<string, number> = {
  running: 0,
  done: 1,
  queued: 2,
  pending: 3,
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Remember whether the field was expanded, keyed to this run, so clicking into an app and hitting
  // back returns to it open. Starts closed for SSR, then reads the saved state on mount.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!runId) return;
    try {
      setOpen(localStorage.getItem(`sloptic.field.${runId}`) === "1");
    } catch {
      /* private mode, blocked storage: fall back to closed */
    }
  }, [runId]);
  const [queuing, setQueuing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function toggle(url: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function gradePicked(urls: string[]) {
    if (!runId || urls.length === 0) return;
    setQueuing(true);
    setNote(null);
    try {
      const res = await fetch("/api/events/run/grade-one", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, projectUrls: urls }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not queue them.");
      setNote(`Queued ${data.queued}.`);
      setPicked(new Set());
      onGraded?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not queue them.");
    } finally {
      setQueuing(false);
    }
  }

  const [page, setPage] = useState(0);
  // Two boxes over one field, so they read as a union: tick nothing and you see everything, tick
  // both and you also see everything, since eligible and skipped are the two halves. A pair of
  // checkboxes that can select nothing at all would just be a way to empty the table.
  const [showEligible, setShowEligible] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  // Status by default: the field is read to find out what happened to it, and alphabetical order
  // answers that only by accident.
  const [sort, setSort] = useState<{ key: "name" | "status"; asc: boolean }>({ key: "status", asc: true });

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

  // Selection follows the FILTER, not the page: ticking "select all" after filtering to what is
  // left ungraded should take all of it, and paging through 8 pages to tick each one is the tedium
  // this is meant to remove.
  const selectable = rows.filter((e) => !e.skip_reason && !e.grade_id && !e.status).map((e) => e.project_url);
  // Ticks are re-read against the live field on every poll, so one that another organizer graded in
  // the meantime stops counting instead of sitting in the total as a queue that will never happen.
  const pickedNow = selectable.filter((u) => picked.has(u));
  const allPicked = selectable.length > 0 && pickedNow.length === selectable.length;

  function click(key: "name" | "status") {
    setPage(0);
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));
  }
  const last = Math.max(0, Math.ceil(rows.length / PAGE) - 1);
  const from = Math.min(page, last) * PAGE;
  const shown = rows.slice(from, from + PAGE);

  return (
    <details
      className="check-detail field-block"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          if (runId) localStorage.setItem(`sloptic.field.${runId}`, next ? "1" : "0");
        } catch {
          /* storage unavailable: the toggle still works for this view */
        }
      }}
    >
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

      {canGrade && runId && selectable.length > 0 && (
        <div className="field-actions">
          <label className="field-filter">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={(e) => setPicked(e.target.checked ? new Set(selectable) : new Set())}
            />
            select all {selectable.length} not yet graded
          </label>
          <button
            className="button"
            type="button"
            disabled={queuing || pickedNow.length === 0}
            onClick={() => void gradePicked(pickedNow)}
          >
            {queuing ? "queuing..." : `Grade ${pickedNow.length} selected`}
          </button>
          {note && <span className="field-note">{note}</span>}
        </div>
      )}

      <div className="table-scroll">
        <table className="count-table">
          <thead>
            <tr>
              {canGrade && runId && selectable.length > 0 && <th className="pick-col" />}
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
                {canGrade && runId && selectable.length > 0 && (
                  <td className="pick-col">
                    {!e.skip_reason && !e.grade_id && !e.status ? (
                      <input
                        type="checkbox"
                        aria-label={`select ${projectName(e.project_url)}`}
                        checked={picked.has(e.project_url)}
                        onChange={() => toggle(e.project_url)}
                      />
                    ) : null}
                  </td>
                )}
                <th scope="row">
                  <a href={e.project_url} target="_blank" rel="noopener noreferrer">
                    {projectName(e.project_url)}
                  </a>
                </th>
                <td className="band-note">
                  {e.skip_reason ? (
                    `skipped (${e.skip_reason})`
                  ) : e.status === "running" ? (
                    <RunningCell gradeId={e.grade_id} progress={e.progress} />
                  ) : e.status === "queued" ? (
                    "waiting"
                  ) : e.status === "failed" ? (
                    "did not respond"
                  ) : e.grade_id ? (
                    <>
                      <a href={`/grade/${e.grade_id}`}>report</a>
                      {e.retrying && (
                        <sup className="prov-mark" title="A challenge-blocked check is being retried. The score may change.">
                          B
                        </sup>
                      )}
                    </>
                  ) : canGrade && runId ? (
                    <button
                      className="link-button"
                      type="button"
                      disabled={queuing}
                      onClick={() => void gradePicked([e.project_url])}
                    >
                      grade now
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

      {rows.some((e) => e.retrying) && (
        <p className="fineprint prov-note">B: a challenge-blocked check is being retried. The score may change.</p>
      )}

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
