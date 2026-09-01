"use client";

import { useEffect, useMemo, useState } from "react";
import type { GradeView, Finding, Coverage, GradeProgress, CardEntry, Outcome } from "@/lib/types";
import { AREA_LABELS, PASSIVE_BY_AREA, describeProbe, type Area } from "@/lib/checks";
import { daysUntil } from "@/lib/retention";
import { ordinal } from "@/lib/grades";
import { forgetGrade } from "@/lib/history";

const POLL_MS = 3000;
const MAX_POLL_FAILS = 8;   // ~1 minute of server errors before giving up on the page
const AREA_ORDER: Area[] = ["security", "qa", "performance"];

/** The score is a damped decimal, so 21.6 must read as 21.6 and 22 must not read as 22.0. Postgres
 *  numeric arrives over JSON as a string, so coerce before formatting. */
function fmtScore(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** mm:ss for an elapsed duration. A long silence reads as a hang; a ticking clock reads as work. */
function elapsed(sinceIso: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** What the grader is doing right now, in a visitor's words. Phase names come from the pipeline:
 *  discover / discovered / lighthouse / lighthouse_done / probes. During probes the current check's
 *  own name is the most informative thing available, and it is how the accessibility pass (axe-core)
 *  announces itself without needing a phase of its own. */
function runningLabel(p: GradeProgress | null | undefined, name: string | null): string {
  if (!p) return "reading the app and running the checks";
  if (p.phase === "lighthouse") {
    // The worker counts the runs, so this reads "performance run 2 of 3" once measuring starts.
    return p.label || "measuring performance, which takes a few minutes";
  }
  if (p.phase === "discover") return "mapping the app's surface";
  if (p.phase === "discovered") return p.label || "mapped the surface";
  if (p.done !== undefined && p.total) {
    return name ? `checking ${name}, ${p.done} of ${p.total}` : `running the checks, ${p.done} of ${p.total}`;
  }
  return p.label || "reading the app and running the checks";
}

export default function GradePage({ params }: { params: { id: string } }) {
  const [view, setView] = useState<GradeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ticks once a second so the elapsed clock moves between polls, which are 3s apart.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    // A server error is usually transient; a 404 is not. Latching on both meant one bad response
    // killed the loop for good, so a page open during a brief outage never recovered even after the
    // grade finished. Retry server errors with backoff, give up only on a real "not found" or after
    // the retries run out.
    let fails = 0;

    async function poll() {
      try {
        const res = await fetch(`/api/grade/${params.id}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!active) return;

        if (res.status === 404) {
          setError(data.error || "Not found.");
          return;
        }
        if (!res.ok) {
          if (++fails > MAX_POLL_FAILS) {
            setError(data.error || "Lookup failed.");
            return;
          }
          timer = setTimeout(poll, POLL_MS * Math.min(fails, 4));
          return;
        }

        fails = 0;
        setView(data);
        if (data.status === "queued" || data.status === "running") {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch {
        if (active) timer = setTimeout(poll, POLL_MS * Math.min(++fails, 4));
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
            ? runningLabel(view.progress, view.progress?.probe ? (describeProbe(view.progress.probe)?.name ?? null) : null)
            : stalled
              ? "waiting, but nothing is running"
              : q && q.ahead > 0
                ? `queued, ${q.ahead} ${q.ahead === 1 ? "grade" : "grades"} ahead`
                : "queued, starting shortly"}
        </p>
        <p className="elapsed">{elapsed(view.submitted_at, now)}</p>
        {view.status === "running" && pct !== null && (
          <span className="progress-track" aria-hidden>
            <span className="progress-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
        {stalled ? (
          <p className="note">No grader is running.</p>
        ) : (
          <p className="note">This takes a few minutes. This page updates itself.</p>
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

    // Prefer the OUTCOMES for what passed: they record what each check actually measured, which is
    // the difference between "clean" as a bare label and "clean" as a claim with a reading behind
    // it. Outcomes fan out per target, so group by probe. Fall back to coverage.applied minus the
    // fired probes for older grades stored before outcomes were kept.
    const cleanByProbe = new Map<string, { evidence: Record<string, unknown>; targets: string[] }>();
    for (const o of (r.outcomes ?? []) as Outcome[]) {
      if (o.outcome !== "clean") continue;
      const cur = cleanByProbe.get(o.probe_id) ?? { evidence: {}, targets: [] };
      if (o.evidence) Object.assign(cur.evidence, o.evidence);
      if (o.target) cur.targets.push(o.target);
      cleanByProbe.set(o.probe_id, cur);
    }

    const passedIds = cleanByProbe.size
      ? [...cleanByProbe.keys()]
      : appliedIds.filter((id) => !firedIds.has(id));

    const passed = passedIds
      .map((id) => ({
        id,
        ...(describeProbe(id) ?? { area: "security" as Area, name: id }),
        evidence: cleanByProbe.get(id)?.evidence ?? {},
        targets: cleanByProbe.get(id)?.targets ?? [],
      }))
      .sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) || a.name.localeCompare(b.name));

    return { rows, passed };
  }, [r]);

  const totalApplied = rows.reduce((n, x) => n + x.applied, 0);
  const totalPossible = rows.reduce((n, x) => n + x.possible, 0);

  // The report card explains a finding (expected / seen / means / fix); the finding itself carries
  // the evidence. Join them on probe_id so an expanded row can show both.
  const cardByProbe = useMemo(() => {
    const m: Record<string, CardEntry> = {};
    for (const sec of r.card?.sections ?? []) {
      for (const e of sec.entries ?? []) if (e.probe_id) m[e.probe_id] = e;
    }
    return m;
  }, [r]);

  return (
    <section className="report">
      <h1>
        {view.url}
        <span className="tag">{r.mode ?? "passive"}</span>
      </h1>

      <div className="score-block">
        <span className="score-num">{fmtScore(r.slop_score)}</span>
        <span className="score-cap">
          <b>slop score</b>
        </span>
        {r.ranking?.cleaner_than_pct !== null && r.ranking?.cleaner_than_pct !== undefined && (
          <span className="rank-block">
            {/* The grader's `percentile` counts apps BETTER than this one, so a low number is good.
                Showing it raw reads as its own opposite: "p19" looks like the bottom fifth when it
                means the top fifth. `cleaner_than_pct` is the share strictly worse, which is the
                direction everyone already expects from a percentile. */}
            <span className="rank-num">{ordinal(r.ranking.cleaner_than_pct)}</span>
            <span className="score-cap">
              <b>percentile compared to others</b>
            </span>
          </span>
        )}
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
          failed / applied / available. {totalApplied} of {totalPossible} applied.
        </span>
      </p>

      <p className="passive-note">
        This is a passive grade only, seeing only what a visitor sees. <a href="/verify">Verify the domain</a> for an active grade.
      </p>

      <Findings findings={r.findings ?? []} card={cardByProbe} />
      <Passed items={passed} />
      {r.platform && Object.keys(r.platform).length > 0 && <Platform platform={r.platform} />}
      <NotApplicable coverage={r.coverage} />
      <ReportKeep view={view} />
    </section>
  );
}

/** What happens to this report, and the button that ends it now.
 *
 *  Anyone may run a grade on an app they do not own, so a report can be about someone who never
 *  asked for it, and the only handle they will ever have is this link. Putting the delete here means
 *  the person with the strongest reason to want it gone can act on that without asking us. */
function ReportKeep({ view }: { view: GradeView }) {
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm("Delete this report? The link stops working and this cannot be undone.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/grade/${view.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete it.");
      forgetGrade(view.id);
      setGone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete it.");
    } finally {
      setBusy(false);
    }
  }

  if (gone) {
    return (
      <p className="report-keep">
        Deleted. <a href="/">Grade another app</a>.
      </p>
    );
  }

  // `claimed` is absent, not false, when the server cannot tell, and guessing at a retention line
  // is worse than leaving it out.
  const known = view.claimed !== undefined;
  const days = view.expires_at ? daysUntil(new Date(view.expires_at)) : null;

  return (
    <p className="report-keep">
      {known && view.claimed ? "Saved to your account, so this report is kept." : null}
      {known && !view.claimed && days !== null
        ? days === 0
          ? "This report is deleted today unless you sign in and save it."
          : `This report is deleted in ${days} day${days === 1 ? "" : "s"} unless you sign in and save it.`
        : null}
      {known && !view.claimed ? (
        <>
          {" "}
          <a href="/grades">Your grades</a>.
        </>
      ) : null}{" "}
      <button className="link-button" type="button" onClick={() => void remove()} disabled={busy}>
        {busy ? "deleting..." : "delete this report"}
      </button>
      {err ? <span className="report-keep-err"> {err}</span> : null}
    </p>
  );
}

/** Evidence is whatever the probe recorded, so the shape varies per check: axe-core rules and a
 *  contrast shortfall here, a status code and timing there. Render it as plain pairs rather than
 *  pretending to a schema, and skip the internals a reader cannot act on. */
const EVIDENCE_SKIP = new Set(["penalty_override", "na_reason"]);

function evidencePairs(ev?: Record<string, unknown>): [string, string][] {
  if (!ev) return [];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(ev)) {
    if (EVIDENCE_SKIP.has(k) || v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out.push([k, v.map(String).join(", ")]);
    } else if (typeof v === "object") {
      const inner = Object.entries(v as Record<string, unknown>);
      if (inner.length === 0) continue;
      out.push([k, inner.map(([ik, iv]) => `${ik}: ${String(iv)}`).join(", ")]);
    } else {
      out.push([k, String(v)]);
    }
  }
  return out;
}

function Findings({ findings, card }: { findings: Finding[]; card: Record<string, CardEntry> }) {
  if (findings.length === 0) {
    return (
      <>
        <h2>What failed</h2>
        <p className="passive-note">Nothing failed :)</p>
      </>
    );
  }
  const sorted = [...findings].sort((a, b) => (b.penalty ?? 0) - (a.penalty ?? 0));
  return (
    <>
      <h2>What failed ({findings.length})</h2>
      <p className="section-intro">Open one for details</p>
      <div className="sample-findings">
        {sorted.map((f, i) => {
          const entry = card[f.probe_id];
          const ev = evidencePairs(f.evidence as Record<string, unknown> | undefined);
          return (
            <details className="finding-detail" data-axis={f.bundle} key={`${f.probe_id}-${i}`}>
              <summary className="finding-row">
                <span className="finding-dot" />
                <span className="finding-body">
                  <span className="finding-cat">{f.category}</span>
                  {f.reason && <span className="finding-desc">{f.reason}</span>}
                  <span className="finding-meta">
                    {[f.probe_id, f.target].filter(Boolean).join("  /  ")}
                  </span>
                </span>
                <span className="finding-pen">+{f.penalty}</span>
              </summary>
              <div className="finding-expand">
                {entry?.expected && (
                  <div className="row2">
                    <span className="term">What should we see</span>
                    <p className="desc">{entry.expected}</p>
                  </div>
                )}
                {(entry?.actual || ev.length > 0) && (
                  <div className="row2">
                    <span className="term">What we saw instead</span>
                    <div className="desc">
                      {entry?.actual && <p>{entry.actual}</p>}
                      {ev.length > 0 && (
                        <dl className="evidence">
                          {ev.map(([k, v]) => (
                            <div key={k}>
                              <dt>{k.replace(/_/g, " ")}</dt>
                              <dd>{v}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  </div>
                )}
                {entry?.indicates && (
                  <div className="row2">
                    <span className="term">Why it matters</span>
                    <p className="desc">{entry.indicates}</p>
                  </div>
                )}
                {entry?.remediation && (
                  <div className="row2">
                    <span className="term">How to fix it</span>
                    <p className="desc">{entry.remediation}</p>
                  </div>
                )}
                {!entry && ev.length === 0 && (
                  <p className="desc">No detail recorded.</p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}

type PassedItem = {
  id: string;
  area: Area;
  name: string;
  evidence: Record<string, unknown>;
  targets: string[];
};

function Passed({ items }: { items: PassedItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h2>What passed ({items.length})</h2>
      <p className="section-intro">Open one for what it measured.</p>
      <div className="sample-findings">
        {items.map((p) => {
          const ev = evidencePairs(p.evidence);
          const targets = [...new Set(p.targets)];
          return (
            <details className="finding-detail passed" data-axis={p.area} key={p.id}>
              <summary className="finding-row passed">
                <span className="finding-dot" />
                <span className="finding-body">
                  <span className="finding-cat">{p.name}</span>
                  <span className="finding-meta">
                    {[p.id, targets.length > 1 ? `${targets.length} targets` : targets[0]]
                      .filter(Boolean)
                      .join("  /  ")}
                  </span>
                </span>
                <span className="finding-pen">0</span>
              </summary>
              <div className="finding-expand">
                {ev.length > 0 ? (
                  <dl className="evidence">
                    {ev.map(([k, v]) => (
                      <div key={k}>
                        <dt>{k.replace(/_/g, " ")}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="desc">No reading recorded.</p>
                )}
              </div>
            </details>
          );
        })}
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
