"use client";

import { useState } from "react";
import type { EventRow } from "@/lib/corpus";

/** One decimal, always. The shared `fmt` drops a trailing .0, which is right in prose and wrong in a
 *  column of statistics: "mean 43" beside "median 28.3" reads as two different precisions. */
const d1 = (n: number) => n.toFixed(1);

const PITCH = 9;   // row pitch. Larger than the 5px bar on purpose: the hit target has to be bigger
const BAR = 5;     // than the mark, or a 5px row is a game of darts.
const W = 720;
const FOOT = 26;

/** Median slop per event, sorted, one mark each.
 *
 *  The chart's job is the SPREAD, so nothing between the two ends is labelled: 61 labels would be
 *  noise and the shape is the argument. That makes the detail a hover job, which is why this is the
 *  one client component on the page.
 *
 *  Keyboard reaches it too, and not by giving 61 rows 61 tab stops, which would trap anyone tabbing
 *  past the chart. The chart is one stop and the arrow keys walk it, with the selected row announced
 *  politely, so the tooltip is not a mouse-only fact.
 */
export default function EventSpread({ events, minN }: { events: EventRow[]; minN: number }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...events.map((e) => e.median));
  const totalH = events.length * PITCH + FOOT;
  const row = active === null ? null : events[active];

  function move(delta: number) {
    setActive((i) => {
      const next = i === null ? 0 : i + delta;
      return Math.max(0, Math.min(events.length - 1, next));
    });
  }

  return (
    <figure className="chart event-spread">
      <div className="event-plot">
        <svg
          viewBox={`0 0 ${W} ${totalH}`}
          tabIndex={0}
          role="img"
          aria-label={`Median slop for each of ${events.length} events, from ${d1(
            events[events.length - 1].median
          )} to ${d1(events[0].median)}. Use the arrow keys to read each event.`}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
            else if (e.key === "Escape") setActive(null);
          }}
          onBlur={() => setActive(null)}
          onMouseLeave={() => setActive(null)}
        >
          {events.map((e, i) => (
            <g key={e.event}>
              <rect
                x="0"
                y={i * PITCH + (PITCH - BAR) / 2}
                width={(e.median / max) * W}
                height={BAR}
                rx={BAR / 2}
                className="bar"
                data-active={i === active || undefined}
              />
              {/* The hit target spans the full row and the full width, so the pointer finds a thin
                  bar without the reader having to aim at it. */}
              <rect
                x="0"
                y={i * PITCH}
                width={W}
                height={PITCH}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
              />
            </g>
          ))}
          <g className="tick">
            <text x="0" y={totalH - 8}>
              each row is one event, sorted by median. {events.length} events with {minN} or more
              graded apps.
            </text>
          </g>
        </svg>

        {row ? (
          <div
            className="event-tip"
            style={{
              // Tracks the row, but CSS clamps it to stay inside the plot: centred on the first or
              // last of 61 rows it would otherwise hang over the paragraphs above and below.
              ["--tip-top" as string]: `${((active! * PITCH + PITCH / 2) / totalH) * 100}%`,
              // Sits past the bar's end, stopping short of the right edge on the widest rows.
              left: `${Math.min((row.median / max) * 100 + 1, 62)}%`,
            }}
          >
            <p className="event-tip-name">{row.event}</p>
            <dl>
              <div><dt>apps</dt><dd>{row.n}</dd></div>
              <div><dt>median</dt><dd>{d1(row.median)}</dd></div>
              <div><dt>mean</dt><dd>{d1(row.mean)}</dd></div>
              <div><dt>st.dev</dt><dd>{d1(row.stdev)}</dd></div>
              <div><dt>range</dt><dd>{d1(row.min)} to {d1(row.max)}</dd></div>
            </dl>
          </div>
        ) : null}
      </div>

      {/* Politely, so arrowing through 61 events does not interrupt whatever is being read. */}
      <p className="visually-hidden" aria-live="polite">
        {row
          ? `${row.event}: ${row.n} apps, median ${d1(row.median)}, mean ${d1(row.mean)}, standard deviation ${d1(row.stdev)}, range ${d1(row.min)} to ${d1(row.max)}.`
          : ""}
      </p>
    </figure>
  );
}
