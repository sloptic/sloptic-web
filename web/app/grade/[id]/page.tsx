"use client";

import { useEffect, useState } from "react";
import type { GradeView, Coverage as CoverageType, Finding } from "@/lib/types";

const POLL_MS = 3000;

export default function GradePage({ params }: { params: { id: string } }) {
  const [view, setView] = useState<GradeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/grade/${params.id}`, { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          setError(data.error || "Lookup failed.");
          return;
        }
        setView(data);
        if (data.status === "queued" || data.status === "running") {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch {
        if (active) timer = setTimeout(poll, POLL_MS);
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!view) return <p className="status">Loading…</p>;

  if (view.status === "queued" || view.status === "running") {
    return (
      <section className="pending">
        <h1>Grading {view.url}</h1>
        <p className="status">
          <span className="spinner" aria-hidden /> {view.status === "queued" ? "Queued…" : "Running the passive battery…"}
        </p>
        <p className="fineprint">
          A grade takes a few minutes: it discovers the surface, then runs the observational probes.
          This page updates itself.
        </p>
      </section>
    );
  }

  if (view.status === "failed") {
    return (
      <section>
        <h1>Could not grade {view.url}</h1>
        <p className="error">{view.error || "The target did not present a gradeable surface."}</p>
      </section>
    );
  }

  return <Report view={view} />;
}

function Report({ view }: { view: GradeView }) {
  const r = view.result!;
  const axes = r.axis_slop;
  return (
    <section className="report">
      <h1>
        {view.url} <span className="badge">passive grade</span>
      </h1>

      <div className="score-hero">
        <div className="score">
          <span className="score-num">{r.slop_score}</span>
          <span className="score-label">slop score</span>
          <span className="score-hint">lower is better · 0 means nothing found</span>
        </div>
        <AxisBars axes={axes} total={r.slop_score} />
      </div>

      <p className="passive-note">
        This is a <strong>passive measurement</strong>: {r.passive_probe_count ?? "the observational"}{" "}
        probes that a normal visitor could observe. It is a subset of the full grade and is{" "}
        <strong>not comparable</strong> to a full-grade percentile, so no population rank is shown.
      </p>

      <Coverage coverage={r.coverage} />
      {r.platform && <Platform platform={r.platform} />}
      <Findings findings={r.findings} />
    </section>
  );
}

function AxisBars({
  axes,
  total,
}: {
  axes: { security: number; qa: number; performance: number };
  total: number;
}) {
  const rows: [string, number][] = [
    ["security", axes.security ?? 0],
    ["qa", axes.qa ?? 0],
    ["performance", axes.performance ?? 0],
  ];
  const max = Math.max(total, 1);
  return (
    <div className="axes">
      {rows.map(([name, val]) => (
        <div className="axis-row" key={name}>
          <span className="axis-name">{name}</span>
          <span className="axis-bar-track">
            <span className="axis-bar-fill" style={{ width: `${(val / max) * 100}%` }} />
          </span>
          <span className="axis-val">{val}</span>
        </div>
      ))}
    </div>
  );
}

function Coverage({ coverage }: { coverage: CoverageType }) {
  const c = coverage || {};
  if (!c.probes_total) return null;
  return (
    <div className="coverage">
      <h2>Coverage</h2>
      <p>
        {c.probes_applicable}/{c.probes_total} probes applicable ({c.pct_applicable}%) · {c.probes_na}{" "}
        n/a. A low score is legible as "clean" only against what was actually testable.
      </p>
    </div>
  );
}

function Platform({ platform }: { platform: Record<string, unknown> }) {
  return (
    <div className="platform">
      <h2>
        Platform <span className="offscore">off-score diagnostic</span>
      </h2>
      <dl>
        {Object.entries(platform)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function Findings({ findings }: { findings: Finding[] }) {
  if (!findings || findings.length === 0) {
    return (
      <div className="findings">
        <h2>Findings</h2>
        <p>Nothing found on the passive surface. Clean, for what was testable.</p>
      </div>
    );
  }
  const sorted = [...findings].sort((a, b) => (b.penalty ?? 0) - (a.penalty ?? 0));
  return (
    <div className="findings">
      <h2>Findings ({findings.length})</h2>
      <ul>
        {sorted.map((f, i) => (
          <li key={`${f.probe_id}-${i}`} className={`finding axis-${f.bundle}`}>
            <div className="finding-head">
              <span className="finding-cat">{f.category}</span>
              <span className="finding-penalty">+{f.penalty}</span>
            </div>
            {f.reason && <p className="finding-reason">{f.reason}</p>}
            <span className="finding-meta">
              {f.bundle} · {f.probe_id}
              {f.target ? ` · ${f.target}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
