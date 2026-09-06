"use client";

import { useState, type ReactNode } from "react";

/** The verdict band: the score, where it places, the per-axis bars, and the readout toggle.
 *
 *  Shared by the real report and the landing page's sample, because it was not, and the sample
 *  drifted into a picture of an older report: it still showed "lower is better" where the report
 *  says "slop score", kept a did-not-apply key in points mode where the report drops it, and used a
 *  toggle that was styled differently. A screenshot-shaped promise on the homepage is worth nothing
 *  if the real thing looks different when it arrives, and the only way to keep two copies identical
 *  is to have one.
 *
 *  Presentational only. Both callers do their own arithmetic and hand over finished rows: the report
 *  from a grade record, the landing from static sample figures.
 */

export type AxisRow = {
  id: string;
  label: string;
  /** checks view: probes that found something, of those that applied, of the battery that ran */
  failed: number;
  applied: number;
  possible: number;
  /** points view: slop this axis carried, and the most it could have carried */
  slop: number;
  potential: number | null;
};

export function fmtScore(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function ScoreBand({
  score,
  cleanerThanPct = null,
  mode,
  rows,
  referenceMark = false,
  footer,
}: {
  score: number | string | null;
  cleanerThanPct?: number | null;
  mode: "passive" | "active";
  rows: AxisRow[];
  /** Adds the asterisk tying the placement to a footnote the caller renders. */
  referenceMark?: boolean;
  /** band-bottom: the report puts its mode tags and actions here, the sample puts nothing. */
  footer?: ReactNode;
}) {
  const [axisView, setAxisView] = useState<"checks" | "slop">("checks");
  const totalApplied = rows.reduce((n, r) => n + r.applied, 0);
  const totalPossible = rows.reduce((n, r) => n + r.possible, 0);

  return (
    <div className="score-band">
      <div className="band-top">
        <div className="score-big">
          {fmtScore(score)}
          <small>slop score</small>
        </div>
        {cleanerThanPct !== null && cleanerThanPct !== undefined && (
          <div className="score-cleaner">
            {/* The grader's `percentile` counts apps BETTER than this one, so a low number is good
                and showing it raw reads as its own opposite. `cleaner_than_pct` is the share
                strictly worse. Said as "cleaner than", not as a percentile: a percentile makes the
                reader supply the direction, and this exact ambiguity already shipped once, with the
                same row reading 19 in one place and 81st in another. */}
            cleaner than <b>{Math.round(cleanerThanPct)}%</b>
            {referenceMark ? "*" : null}
            <span>of {mode === "active" ? "actively" : "passively"} graded apps</span>
          </div>
        )}
        <span className="grow" />
        <span className="mode-toggle" role="group" aria-label="axis readout">
          <button
            type="button"
            className={axisView === "checks" ? "on" : ""}
            aria-pressed={axisView === "checks"}
            onClick={() => setAxisView("checks")}
          >
            checks
          </button>
          <button
            type="button"
            className={axisView === "slop" ? "on" : ""}
            aria-pressed={axisView === "slop"}
            onClick={() => setAxisView("slop")}
          >
            slop points
          </button>
        </span>
      </div>

      <div className="score-axes">
        <div className="sample-axes">
          {rows.map((row) => {
            // Points mode rescales the bar: slop carried against the axis's ceiling, and the
            // survived remainder. The did-not-apply segment disappears, because points have no
            // equivalent of a check that never ran.
            const scaled = axisView === "slop" && row.potential !== null;
            return (
              <div className="sample-axis" data-axis={row.id} key={row.id}>
                <span className="sample-axis-name">{row.label}</span>
                <span className="sample-axis-track">
                  <span className="seg failed" style={{ flexGrow: scaled ? row.slop : row.failed }} />
                  <span
                    className="seg clean"
                    style={{
                      flexGrow: scaled
                        ? Math.max(0, (row.potential ?? 0) - row.slop)
                        : Math.max(0, row.applied - row.failed),
                    }}
                  />
                  {!scaled && (
                    <span
                      className="seg na"
                      style={{ flexGrow: Math.max(0, row.possible - row.applied) }}
                    />
                  )}
                </span>
                <span className="sample-axis-val">
                  {axisView === "checks" ? (
                    <>
                      {row.failed}
                      <span className="of">/{row.applied}</span>
                      <span className="of dim">/{row.possible}</span>
                    </>
                  ) : (
                    <>
                      {fmtScore(row.slop)}
                      {row.potential !== null && (
                        <span className="of dim"> / {fmtScore(row.potential)} pts</span>
                      )}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <p className="sample-legend">
          {axisView === "checks" ? (
            <>
              <span className="key failed" aria-hidden /> failed
              <span className="key clean" aria-hidden /> passed
              <span className="key na" aria-hidden /> did not apply
              <span className="legend-note">
                failed / applied / available. {totalApplied} of {totalPossible} applied.
              </span>
            </>
          ) : (
            <>
              <span className="key failed" aria-hidden /> carried
              <span className="key clean" aria-hidden /> survived
              <span className="legend-note">
                slop carried, against the most this axis could have carried had every applicable
                check fired.
              </span>
            </>
          )}
        </p>

        {footer !== undefined && <div className="band-bottom">{footer}</div>}
      </div>
    </div>
  );
}
