"use client";

import { useEffect, useMemo, useState } from "react";
import type { GradeView, Finding, Coverage, GradeProgress } from "@/lib/types";
import { AREA_LABELS, PASSIVE_BY_AREA, describeProbe, type Area } from "@/lib/checks";

const POLL_MS = 3000;
const AREA_ORDER: Area[] = ["security", "qa", "performance"];

/** What the grader is doing right now, in a visitor's words. The phase label matters more than the
 *  probe count: Lighthouse is a silent two-to-three minute stretch, and saying so is the difference
 *  between "working" and "stuck". */
function runningLabel(p?: GradeProgress | null): string {
  if (!p) return "reading the app and running the checks";
  if (p.phase === "lighthouse") return "measuring performance, which takes a few minutes";
  if (p.phase === "crawl") return "mapping the app's surface";
  if (p.done !== undefined && p.total) return `running the checks, ${p.done} of ${p.total}`;
  return p.label || "reading the app and running the checks";
}

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
    // A wait that cannot explain itself is just a spinner. Say which of the three situations this
    // is: being graded, waiting behind other grades, or waiting on nothing at all.
    const q = view.queue;
    const stalled = view.status === "queued" && q?.stalled;
    const p = view.progress;
    const pct =
      p && p.total && p.done !== undefined ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
    return (
      <section className="pending">
        <h1>{view.url}</h1>
        <p className="status">
          {!stalled && <span className="tick" aria-hidden />}
          {view.status === "running"
            ? runningLabel(view.progress)
            : stalled
              ? "waiting, but nothing is running"
              : q && q.ahead > 0
                ? `queued, ${q.ahead} ${q.ahead === 1 ? "grade" : "grades"} ahead`
                : "queued, starting shortly"}
        </p>
        {view.status === "running" && pct !== null && (
          <span className="progress-track" aria-hidden>
            <span className="progress-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
        {stalled ? (
          <p className="note">
            No grader has checked in recently, so this has not started and will not start until one
            is back. Nothing is wrong with the app you submitted. The grade gives up after fifteen
            minutes rather than leaving you here, and you can submit it again later.
          </p>
        ) : (
          <p className="note">
            A grade takes a few minutes. It maps the surface, then loads the app in a real browser to
            measure it{q && q.ahead > 0 ? ", and yours starts when the ones ahead finish" : ""}. This
            page updates on its own.
          </p>
        )}
      </section>
    );
  }

  if (view.status === "failed") {
    return (
      <section className="report">
        <h1>{view.url}</h1>
        <p className="error">{view.error || "The target did not present a gradeable surface."}</p>
      </section>
    );
  }

  return <Report view={view} />;
}

type AreaRow = {
  id: Area;
  label: string;
  failed: number;
  applied: number;
  possible: number;
  slop: number;
};

function Report({ view }: { view: GradeView }) {
  const r = view.result!;

  // Everything the bars need, derived from the record: what fired, what applied, and what this mode
  // could have run. `coverage.applied` lists the probes that applied by id, so what PASSED is what
  // applied minus what fired.
  const { rows, passed } = useMemo(() => {
    const findings: Finding[] = r.findings ?? [];
    const appliedIds: string[] = (r.coverage?.applied as string[] | undefined) ?? [];
    const firedIds = new Set(findings.map((f) => f.probe_id));

    const failedBy: Record<string, number> = {};
    for (const f of findings) failedBy[f.bundle] = (failedBy[f.bundle] ?? 0) + 1;

    const appliedBy: Record<string, number> = {};
    for (const id of appliedIds) {
      const d = describeProbe(id);
      if (d) appliedBy[d.area] = (appliedBy[d.area] ?? 0) + 1;
    }

    const rows: AreaRow[] = AREA_ORDER.map((id) => ({
      id,
      label: AREA_LABELS[id],
      failed: failedBy[id] ?? 0,
      applied: appliedBy[id] ?? 0,
      possible: PASSIVE_BY_AREA[id] ?? 0,
      // an axis with nothing wrong is absent from axis_slop entirely, not zero
      slop: r.axis_slop?.[id as keyof typeof r.axis_slop] ?? 0,
    }));

    const passed = appliedIds
      .filter((id) => !firedIds.has(id))
      .map((id) => ({ id, ...(describeProbe(id) ?? { area: "security" as Area, name: id }) }))
      .sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) || a.name.localeCompare(b.name));

    return { rows, passed };
  }, [r]);

  const totalApplied = rows.reduce((n, x) => n + x.applied, 0);
  const totalPossible = rows.reduce((n, x) => n + x.possible, 0);

  return (
    <section className="report">
      <h1>
        {view.url}
        <span className="tag">{r.mode ?? "passive"}</span>
      </h1>

      <div className="score-block">
        <span className="score-num">{r.slop_score}</span>
        <span className="score-cap">
          <b>slop score</b>
          lower is better
          <br />0 means nothing found
        </span>
      </div>

      <div className="sample-axes">
        {rows.map((row) => (
          <div className="sample-axis" data-axis={row.id} key={row.id}>
            <span className="sample-axis-name">{row.label}</span>
            <span className="sample-axis-track">
              <span className="seg failed" style={{ flexGrow: row.failed }} />
              <span className="seg clean" style={{ flexGrow: row.applied - row.failed }} />
              <span className="seg na" style={{ flexGrow: Math.max(0, row.possible - row.applied) }} />
            </span>
            <span className="sample-axis-val">
              {row.failed}
              <span className="of">/{row.applied}</span>
              <span className="of dim">/{row.possible}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="sample-legend">
        <span className="key failed" aria-hidden /> failed
        <span className="key clean" aria-hidden /> passed
        <span className="key na" aria-hidden /> did not apply
        <span className="legend-note">
          Checks that failed, out of those that applied, out of every check this mode could run.{" "}
          {totalApplied} of {totalPossible} applied here.
        </span>
      </p>

      <p className="passive-note">
        This is the passive check, the {r.passive_probe_count ?? totalPossible} checks observable
        without verifying the domain. It is a different measurement from a full grade, so there is no
        population percentile here. <a href="/verify">Verify the domain</a> to run the rest.
      </p>

      <Findings findings={r.findings ?? []} />
      <Passed items={passed} />
      {r.platform && Object.keys(r.platform).length > 0 && <Platform platform={r.platform} />}
      <NotApplicable coverage={r.coverage} />
    </section>
  );
}

function Findings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <>
        <h2>What failed</h2>
        <p className="passive-note">Nothing failed on the checks that applied.</p>
      </>
    );
  }
  const sorted = [...findings].sort((a, b) => (b.penalty ?? 0) - (a.penalty ?? 0));
  return (
    <>
      <h2>What failed ({findings.length})</h2>
      <div className="sample-findings">
        {sorted.map((f, i) => (
          <div className="finding-row" data-axis={f.bundle} key={`${f.probe_id}-${i}`}>
            <span className="finding-dot" />
            <span className="finding-body">
              <span className="finding-cat">{f.category}</span>
              {f.reason && <span className="finding-desc">{f.reason}</span>}
              <span className="finding-meta">
                {[f.probe_id, f.target].filter(Boolean).join("  /  ")}
              </span>
            </span>
            <span className="finding-pen">+{f.penalty}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Passed({ items }: { items: { id: string; area: Area; name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h2>What passed ({items.length})</h2>
      <div className="sample-findings">
        {items.map((p) => (
          <div className="finding-row passed" data-axis={p.area} key={p.id}>
            <span className="finding-dot" />
            <span className="finding-body">
              <span className="finding-cat">{p.name}</span>
              <span className="finding-meta">{p.id}</span>
            </span>
            <span className="finding-pen">0</span>
          </div>
        ))}
      </div>
    </>
  );
}

function NotApplicable({ coverage }: { coverage: Coverage }) {
  const c = coverage ?? {};
  const reasons: Record<string, string> = c.na_reasons ?? {};
  if (!c.probes_na) return null;
  return (
    <>
      <h2>
        Did not apply ({c.probes_na}) <span className="offscore">not a pass</span>
      </h2>
      <p className="passive-note">
        These could not be tested here, so they are neither a pass nor a fail. A check with no login in
        front of it cannot report that the login is safe.
      </p>
      {Object.keys(reasons).length > 0 && (
        <div className="platform">
          <dl>
            {Object.entries(reasons).map(([kind, why]) => (
              <div key={kind} style={{ display: "contents" }}>
                <dt>{kind}</dt>
                <dd>{String(why)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

function Platform({ platform }: { platform: Record<string, unknown> }) {
  const rows = Object.entries(platform).filter(([, v]) => v != null && v !== "" && v !== false);
  if (rows.length === 0) return null;
  return (
    <>
      <h2>
        Platform <span className="offscore">off-score</span>
      </h2>
      <div className="platform">
        <dl>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
