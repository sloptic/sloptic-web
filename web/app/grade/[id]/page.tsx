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
  if (!view) return <p className="status">loading</p>;

  if (view.status === "queued" || view.status === "running") {
    return (
      <section className="pending">
        <h1>{view.url}</h1>
        <p className="status">
          <span className="tick" aria-hidden />
          {view.status === "queued" ? "queued" : "reading the app and running the passive checks"}
        </p>
        <p className="note">
          A grade takes a few minutes: it maps the surface, then runs the observational probes. This
          page updates on its own.
        </p>
      </section>
    );
  }

  if (view.status === "failed") {
    return (
      <section>
        <h1 className="report">{view.url}</h1>
        <p className="error">{view.error || "The target did not present a gradeable surface."}</p>
      </section>
    );
  }

  return <Report view={view} />;
}

function Report({ view }: { view: GradeView }) {
  const r = view.result!;
  return (
    <section className="report">
      <h1>
        {view.url}
        <span className="tag">passive</span>
      </h1>

      <div className="score-block">
        <span className="score-num">{r.slop_score}</span>
        <span className="score-cap">
          <b>slop score</b>
          lower is better
          <br />0 means nothing found
        </span>
      </div>

      <AxisBars axes={r.axis_slop} total={r.slop_score} />

      <p className="passive-note">
        Passive check: {r.passive_probe_count ?? 37} of 91 probes, the ones observable without
        verifying the domain. It is a different measurement from a full grade, so there is no
        population percentile here. Verify the domain to run the rest.
      </p>

      <Coverage coverage={r.coverage} />
      {r.platform && Object.keys(r.platform).length > 0 && <Platform platform={r.platform} />}
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
  const rows: Array<{ key: string; label: string; val: number }> = [
    { key: "security", label: "security", val: axes.security ?? 0 },
    { key: "qa", label: "accessibility", val: axes.qa ?? 0 },
    { key: "performance", label: "performance", val: axes.performance ?? 0 },
  ];
  const max = Math.max(total, 1);
  return (
    <div className="axes">
      {rows.map((row) => (
        <div className="axis-row" data-axis={row.key} key={row.key}>
          <span className="axis-name">{row.label}</span>
          <span className="axis-track">
            <span className="axis-fill" style={{ width: `${(row.val / max) * 100}%` }} />
          </span>
          <span className="axis-val">{row.val}</span>
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
        {c.probes_applicable} of {c.probes_total} probes applied ({c.pct_applicable}%), {c.probes_na}{" "}
        not applicable. A low score reads as clean only against what could be tested.
      </p>
    </div>
  );
}

function Platform({ platform }: { platform: Record<string, unknown> }) {
  const rows = Object.entries(platform).filter(([, v]) => v != null && v !== "");
  if (rows.length === 0) return null;
  return (
    <div className="platform">
      <h2>
        Platform <span className="offscore">off-score</span>
      </h2>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
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
        <p className="passive-note">Nothing found on the passive surface. Clean, for what was tested.</p>
      </div>
    );
  }
  const sorted = [...findings].sort((a, b) => (b.penalty ?? 0) - (a.penalty ?? 0));
  return (
    <div className="findings">
      <h2>Findings ({findings.length})</h2>
      <ol>
        {sorted.map((f, i) => (
          <li className="finding" data-axis={f.bundle} key={`${f.probe_id}-${i}`}>
            <div className="finding-head">
              <span className="finding-cat">
                <span className="swatch" aria-hidden />
                {f.category}
              </span>
              <span className="finding-penalty">+{f.penalty}</span>
            </div>
            {f.reason && <p className="finding-reason">{f.reason}</p>}
            <span className="finding-meta">
              {[f.bundle, f.probe_id, f.target].filter(Boolean).join("  /  ")}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
