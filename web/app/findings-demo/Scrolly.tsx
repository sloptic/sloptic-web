"use client";

import { useEffect, useRef, useState } from "react";

// The sticky graphic pattern (The Pudding's scrollytelling): a chart stays pinned while short
// paragraphs scroll past it, and whichever paragraph sits mid-screen decides what the chart shows.
// The bars are the same elements in every step, so a change of step animates rather than redraws.
// Renders step 1 on the server, so the page reads with no script.

export type ScrollyStep = {
  text: string;
  /** What the chart measures in this step, e.g. "median slop, lower is better". */
  chart: string;
  /** A short label under the bars, for the point this step makes. */
  note?: string;
  max: number;
  rows: { who: string; v: number; show: string; hot?: boolean }[];
};

export default function Scrolly({ steps }: { steps: ScrollyStep[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  const s = steps[active];
  return (
    <div className="scrolly">
      <figure className="scrolly-graphic">
        <figcaption className="scrolly-chart">{s.chart}</figcaption>
        <div className="sbars">
          {s.rows.map((r, i) => (
            <div className="sbar" data-hot={r.hot ? "" : undefined} key={i}>
              <span className="sbar-who">{r.who}</span>
              <span className="sbar-track">
                <span className="sbar-fill" style={{ width: `${(r.v / s.max) * 100}%` }} />
              </span>
              <span className="sbar-num">{r.show}</span>
            </div>
          ))}
        </div>
        <p className="scrolly-note">{s.note ?? " "}</p>
      </figure>
      <div className="scrolly-steps">
        {steps.map((st, i) => (
          <div
            className="step"
            data-step={i}
            data-on={i === active ? "" : undefined}
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
          >
            <p>{st.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
