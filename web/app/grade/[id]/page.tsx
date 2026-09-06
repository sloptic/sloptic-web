"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@vercel/analytics";
import type { GradeView, GradeResult, Finding, Coverage, GradeProgress, CardEntry, Outcome } from "@/lib/types";
import { AREA_LABELS, AREAS, PASSIVE_BY_AREA, TOTALS, categoryName, describeCategory, describeProbe, type Area } from "@/lib/checks";
import { daysUntil } from "@/lib/retention";
import { failureText, ordinal, recoveryMarks } from "@/lib/grades";
import RecoverySup from "@/app/RecoverySup";
import { forgetGrade } from "@/lib/history";

const POLL_MS = 3000;
const MAX_POLL_FAILS = 8;   // ~1 minute of server errors before giving up on the page
const RETRY_POLL_MS = 20000; // a finished grade with a blocked tail is re-checked at this cadence,
//                              since the next recovery pass is minutes out, not seconds
const AREA_ORDER: Area[] = ["security", "qa", "performance"];

/** The score is a damped decimal, so 21.6 must read as 21.6 and 22 must not read as 22.0. Postgres
 *  numeric arrives over JSON as a string, so coerce before formatting. */
function fmtScore(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The categories behind a set of blocked probe ids, most-blocked first: "sql injection (4), file
 *  upload (2)". Unknown ids (catalog drift) drop out rather than show a bare slug. */
function blockedCategories(blocked: string[]): string {
  const counts = new Map<string, { name: string; n: number }>();
  for (const id of blocked) {
    const d = describeCategory(id);
    if (!d) continue;
    const cur = counts.get(d.slug);
    if (cur) cur.n += 1;
    else counts.set(d.slug, { name: d.name, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map((c) => (c.n > 1 ? `${c.name} (${c.n})` : c.name))
    .join(", ");
}

/** mm:ss for an elapsed duration. A long silence reads as a hang; a ticking clock reads as work. */
function elapsed(sinceIso: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** The blocked-tail recovery, in a reader's words. Returns null when there is nothing to say: no
 *  tail was blocked, or it was recovered. Three states otherwise: a pass is due later (cooling down
 *  while the block clears), a pass is due now, or the passes ran out and the tail stays unmeasured. */
function retryStatus(
  retryDueAt: string | null | undefined,
  retryPasses: number | undefined,
  blocked: number,
  now: number,
): string | null {
  if (retryDueAt) {
    const mins = Math.max(1, Math.round((Date.parse(retryDueAt) - now) / 60000));
    if (Date.parse(retryDueAt) - now > 45000) {
      return `Next attempt in about ${mins} min.`;
    }
    return "Next attempt runs shortly.";
  }
  if ((retryPasses ?? 0) > 0 && blocked > 0) {
    return `Still blocked after ${retryPasses} more ${retryPasses === 1 ? "try" : "tries"}.`;
  }
  return null;
}

/** What the grader is doing right now, in a visitor's words. Phase names come from the pipeline:
 *  discover / discovered / lighthouse / lighthouse_done / probes. During probes the current check's
 *  own name is the most informative thing available, and it is how the accessibility pass (axe-core)
 *  announces itself without needing a phase of its own. */
function runningLabel(p: GradeProgress | null | undefined, name: string | null): string {
  if (!p) return "reading the app";
  if (p.phase === "lighthouse") {
    // The worker counts the runs, so this reads "performance run 2 of 3" once measuring starts.
    return p.label || "measuring performance";
  }
  if (p.phase === "discover") return "mapping the app's surface";
  if (p.phase === "discovered") return p.label || "mapped the surface";
  if (p.done !== undefined && p.total) {
    return name ? `checking ${name}, ${p.done} of ${p.total}` : `running the checks, ${p.done} of ${p.total}`;
  }
  return p.label || "reading the app";
}

/** Resume a paused run, for the organizer who paused it. Rendered wherever the pause changes what
 *  the page would otherwise say (a held retry, a queued grade that is not moving). */
function ResumeRun({ event, onResumed }: { event: NonNullable<GradeView["event"]>; onResumed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!event.canResume) return null;
  return (
    <span className="resume-run">
      {" "}
      <button
        className="link-button"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const res = await fetch("/api/events/run/pause", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: event.runId, paused: false }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Could not resume.");
            onResumed();
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not resume.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "resuming" : "Resume grading"}
      </button>
      {err && <span className="report-keep-err"> {err}</span>}
    </span>
  );
}

/** The event run that queued this grade, when one did. A grade reached from an event's field has no
 *  other way back, and the event page resolves for the organizer, who is the viewer this button is
 *  for. Rendered above the header on every state, since a running grade is followed from the field
 *  too. */
function EventCrumb({ slug }: { slug: string }) {
  return (
    <p className="crumb">
      <a href={`/events/${slug}`}>← Back to {slug}</a>
    </p>
  );
}

export default function GradePage({ params }: { params: { id: string } }) {
  const [view, setView] = useState<GradeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ticks once a second so the elapsed clock moves between polls, which are 3s apart.
  const [now, setNow] = useState(() => Date.now());
  // The live poll, exposed so a resume action can ask for fresh truth immediately instead of
  // waiting out the (slow) retry poll interval.
  const pollRef = useRef<() => void>(() => {});
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
    // Track the terminal state once per view: the funnel event is the OUTCOME, not the polls.
    let terminal = false;

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
          // A response that is not OUR JSON never reached us: something in between answered instead,
          // which on a site behind a WAF is usually a challenge page aimed at the background fetch.
          // Saying "lookup failed" there blames our database for a request it never received, the
          // same collapse of "could not look" into "it is broken" that this product refuses to make
          // about the apps it grades. Found by actively grading ourselves and tripping our own CDN,
          // which turned out to be a better test than any of the ones I wrote.
          const ours = (res.headers.get("content-type") || "").includes("application/json");
          if (++fails > MAX_POLL_FAILS) {
            setError(
              ours
                ? data.error || "Lookup failed."
                : "Something between your browser and Sloptic blocked this request. Reload the page."
            );
            return;
          }
          timer = setTimeout(poll, POLL_MS * Math.min(fails, 4));
          return;
        }

        fails = 0;
        setView(data);
        // One funnel event per view, on the outcome: the polls before it are just waiting.
        if (!terminal && (data.status === "done" || data.status === "failed")) {
          terminal = true;
          track(data.status === "done" ? "grade_finished" : "grade_failed");
        }
        if (data.status === "queued" || data.status === "running") {
          clearTimeout(timer);
          timer = setTimeout(poll, POLL_MS);
        } else if (data.retry_due_at) {
          // Done, but a blocked tail is booked for another pass. Keep polling, slowly, so the "next
          // attempt in about N minutes" line moves and the report updates itself the moment the pass
          // recovers the tail.
          clearTimeout(timer);
          timer = setTimeout(poll, RETRY_POLL_MS);
        }
      } catch {
        if (active) timer = setTimeout(poll, POLL_MS * Math.min(++fails, 4));
      }
    }
    pollRef.current = poll;
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!view) return <p className="status">loading</p>;
  const crumb = view.event ? <EventCrumb slug={view.event.slug} /> : null;

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
        {crumb}
        <h1>{view.origin ?? view.url}</h1>
        <p className="status">
          {!stalled && <span className="tick" aria-hidden />}
          {view.status === "running"
            ? runningLabel(view.progress, view.progress?.probe ? (describeProbe(view.progress.probe)?.name ?? null) : null)
            : stalled
              ? "nothing is running"
              : q && q.ahead > 0
                ? `queued, ${q.ahead} ${q.ahead === 1 ? "grade" : "grades"} ahead`
                : "queued, starting shortly"}
        </p>
        <p className="elapsed">
          {elapsed(
            view.status === "running" && view.claimed_at ? view.claimed_at : view.submitted_at,
            now,
          )}
        </p>
        {typeof view.progress?.slop_preview === "number" && (
          <p className="note">
            Slop so far: <b className="mono">{view.progress.slop_preview.toFixed(1)}</b>
          </p>
        )}
        {view.status === "running" && pct !== null && (
          <span className="progress-track" aria-hidden>
            <span className="progress-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
        {stalled ? (
          <p className="note">No grader is running.</p>
        ) : view.event?.paused ? (
          <p className="note">
            This grade&apos;s run is paused by the organizer; it holds its place.
            <ResumeRun event={view.event} onResumed={() => pollRef.current()} />
          </p>
        ) : (
          <p className="note">This takes a few minutes. This page updates itself.</p>
        )}
      </section>
    );
  }

  if (view.status === "failed" || view.status === "cancelled") {
    return (
      <section className="report">
        {crumb}
        <h1>{view.origin ?? view.url}</h1>
        <p className="error">{failureText(view.error)}</p>
      </section>
    );
  }

  // A done grade whose results row is gone has been through retention: the grade row is kept, the
  // report is not. Rendering Report here would dereference null; the honest page is the promise
  // the retention copy made, kept.
  if (view.status === "done" && !view.result) {
    return (
      <section className="report">
        {crumb}
        <h1>{view.origin ?? view.url}</h1>
        <p className="error">This report has expired.</p>
        <p className="section-intro">
          Anonymous reports are kept for {view.retain_days ?? 30} days. Grade the app again for a fresh one.
        </p>
      </section>
    );
  }

  return <Report view={view} now={now} onResume={() => pollRef.current()} />;
}

/** The offer to run the full battery, shown only to someone who has already verified this origin.
 *
 *  Here rather than on the form: the homepage is the anonymous front door, and a battery toggle there
 *  asks a question almost nobody who sees it can answer. At this point the question is concrete, the
 *  origin is settled, and the passive result is on screen to be compared against.
 */
function GradeActively({ origin }: { origin: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="run-controls upgrade-row">
      <button
        className="button"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/grade", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ url: origin, mode: "active" }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not start it.");
            router.push(`/grade/${data.id}`);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not start it.");
            setBusy(false);
          }
        }}
      >
        {busy ? "starting..." : "Grade actively"}
      </button>
      {error && <span className="report-keep-err">{error}</span>}
    </div>
  );
}

type AreaRow = {
  id: Area;
  label: string;
  failed: number;
  applied: number;
  possible: number;
  slop: number;
  potential: number | null;
};

function Report({ view, now, onResume }: { view: GradeView; now: number; onResume: () => void }) {
  const r = view.result!;
  // The band's readout: check counts, or the slop points each axis actually carried. The bars stay
  // check-based in both, since "applied" is a count and points have no applied/available split.
  const [axisView, setAxisView] = useState<"checks" | "slop">("checks");

  // Did the probe loop actually run? The grader writes coverage.probes_total only once it reaches
  // the battery, and outcomes only for probes that ran. Neither, plus blocked probes, means a bot
  // challenge stopped the grade before anything was measured: the score is 0 because nothing ran,
  // not because the app is clean. Showing that 0 as a grade is the bug this guards.
  const blockedProbes = r.blocked_probes ?? [];
  const ranAnything = (r.coverage?.probes_total ?? 0) > 0 || (r.outcomes?.length ?? 0) > 0;
  const withheld =
    !ranAnything && (blockedProbes.length > 0 || r.bot_challenge === true || r.challenge_stage === "entry");
  // r.challenge_onset_index: how far the grade got before the challenge, for the withheld note.

  // Everything the bars need, derived from the record: what fired, what applied, and what this mode
  // could have run. `coverage.applied` lists the probes that applied by id, so what PASSED is what
  // applied minus what fired.
  const { rows, passed } = useMemo(() => {
    const findings: Finding[] = r.findings ?? [];
    const appliedIds: string[] = (r.coverage?.applied as string[] | undefined) ?? [];
    const firedIds = new Set(findings.map((f) => f.probe_id));

    // How many PROBES found something, not how many findings there were. One probe firing on eight
    // paths is eight findings and one failed check, and counting findings made "failed" exceed
    // "applied": a security axis read 51 of 15, and the passed segment took a negative width.
    const failedProbes: Record<string, Set<string>> = {};
    for (const f of findings) {
      (failedProbes[f.bundle] ??= new Set()).add(f.probe_id);
    }
    const failedBy: Record<string, number> = {};
    for (const [bundle, ids] of Object.entries(failedProbes)) failedBy[bundle] = ids.size;

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
      // The denominator is the battery that ran: the full per-axis counts for an active grade, the
      // passive floor for a passive one. PASSIVE_BY_AREA alone made every active report claim a
      // 44-check battery and show more applied than available.
      possible:
        (r.mode ?? "passive") === "active"
          ? AREAS.find((a) => a.id === id)?.probes ?? 0
          : PASSIVE_BY_AREA[id] ?? 0,
      // an axis with nothing wrong is absent from axis_slop entirely, not zero
      slop: r.axis_slop?.[id as keyof typeof r.axis_slop] ?? 0,
      // what the axis would have cost if every applicable check had fired; the slop view's ceiling
      potential: r.axis_potential?.[id as keyof typeof r.axis_potential] ?? null,
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
        ...(describeCategory(id) ?? { area: "security" as Area, slug: id, name: id }),
        evidence: cleanByProbe.get(id)?.evidence ?? {},
        targets: cleanByProbe.get(id)?.targets ?? [],
      }))
      .sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) || a.name.localeCompare(b.name));

    return { rows, passed };
  }, [r]);

  const totalApplied = rows.reduce((n, x) => n + x.applied, 0);
  const totalPossible = rows.reduce((n, x) => n + x.possible, 0);
  // The same letters the lists show, computed from the record the same way, so the report and the
  // board cannot disagree about what the retries achieved.
  const bandMarks = recoveryMarks({
    retryDueAt: view.retry_due_at,
    retryPasses: view.retry_passes,
    initial: r.retry_blocked_initial,
    blocked: blockedProbes.length,
    limitedEngagement:
      r.ranking?.reporting?.status === "limited_engagement" || r.challenge_stage === "limited",
  });

  // The report card explains a finding (expected / seen / means / fix); the finding itself carries
  // the evidence. Join them on probe_id so an expanded row can show both.
  const cardByProbe = useMemo(() => {
    const m: Record<string, CardEntry> = {};
    for (const sec of r.card?.sections ?? []) {
      for (const e of sec.entries ?? []) if (e.probe_id) m[e.probe_id] = e;
    }
    return m;
  }, [r]);

  // Rendered after EVERY hook above, deliberately. A recovery pass can flip a withheld grade to a
  // scored one between two polls of the same mounted page, and an early return higher up would
  // change the hook count mid-mount, which React treats as a fatal error.
  if (withheld)
    return <Withheld view={view} blocked={blockedProbes} now={now} onResume={onResume} />;

  return (
    <section className="report">
      {view.event && <EventCrumb slug={view.event.slug} />}
      <h1 className="report-url">{view.origin ?? view.url}</h1>
      {/* A grade is pinned to the origin, so a submitted path would be a claim about a page this
          report never singles out. */}
      {view.origin && view.origin !== view.url.replace(/\/+$/, "") && (
        <p className="section-intro fineprint">Submitted as {view.url}. A grade covers the whole origin.</p>
      )}
      {view.can_grade_actively && view.origin && <GradeActively origin={view.origin} />}

      {/* One band for the whole verdict: score, placement, the bars, and what qualifies it. The
          findings and their evidence stay below, unchanged; nothing up here explains a fault. */}
      <div className="score-band">
        <div className="band-top">
        <div className="score-big">
          {fmtScore(r.slop_score)}
          <small>slop score</small>
        </div>
        {r.ranking?.cleaner_than_pct !== null && r.ranking?.cleaner_than_pct !== undefined && (
          <div className="score-cleaner">
            {/* The grader's `percentile` counts apps BETTER than this one, so a low number is good and
                showing it raw reads as its own opposite. `cleaner_than_pct` is the share strictly
                worse. Said as "cleaner than", not as a percentile: a percentile makes the reader
                supply the direction, and this exact ambiguity already shipped once, with the same row
                reading 19 in one place and 81st in another. */}
            cleaner than <b>{Math.round(r.ranking.cleaner_than_pct)}%</b>
            {r.ranking?.reference ? "*" : null}
            <span>of {r.mode === "active" ? "actively" : "passively"} graded apps</span>
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
            {rows.map((row) => (
              <div className="sample-axis" data-axis={row.id} key={row.id}>
                <span className="sample-axis-name">{row.label}</span>
                <span className="sample-axis-track">
                  {/* points mode rescales the bar: slop carried against the axis's ceiling, and the
                      survived remainder. The did-not-apply segment disappears, because points have
                      no attribution to checks that never ran. Grades without stored potential keep
                      the check-count bar. */}
                  <span
                    className="seg failed"
                    style={{ flexGrow: axisView === "slop" && row.potential !== null ? row.slop : row.failed }}
                  />
                  <span
                    className="seg clean"
                    style={{
                      flexGrow:
                        axisView === "slop" && row.potential !== null
                          ? Math.max(0, row.potential - row.slop)
                          : Math.max(0, row.applied - row.failed),
                    }}
                  />
                  {!(axisView === "slop" && row.potential !== null) && (
                    <span className="seg na" style={{ flexGrow: Math.max(0, row.possible - row.applied) }} />
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
            ))}
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
                  slop carried, against the most this axis could have carried had every applicable check fired.
                </span>
              </>
            )}
          </p>
          <div className="band-bottom">
            {r.ranking?.reference ? (
              <p className="band-footnote">* compared against {r.ranking.reference}.</p>
            ) : <span />}
            <div className="score-chips">
              <span className="tag">{r.mode ?? "passive"}</span>
              {r.challenge_stage === "limited" && <span className="tag">limited</span>}
              <RecoverySup marks={bandMarks} />
            </div>
          </div>
        </div>
      </div>

      <ChallengeNote
        blocked={r.blocked_probes ?? []}
        retryDueAt={view.retry_due_at}
        retryPasses={view.retry_passes}
        initial={r.retry_blocked_initial}
        now={now}
        event={view.event}
        onResume={onResume}
      />

      <RankDetail r={r} />

      <Surface surface={r.surface ?? null} />
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
/** A grade a bot challenge stopped before anything ran. The app answered, so it is not a DNF, but
 *  its protection blocked every check, so there is no measurement. The one thing this must not do is
 *  show the 0 as a score: a withheld grade read as a clean one is the whole failure. */
function Withheld({ view, blocked, now, onResume }: { view: GradeView; blocked: string[]; now: number; onResume: () => void }) {
  const retry = retryStatus(view.retry_due_at, view.retry_passes, blocked.length, now);
  // How far the grade got before the challenge tripped. The grader withholds anything whose onset
  // landed before 60% of the battery, so "nothing ran" would be a lie for a grade cut down at, say,
  // check 47 of 102. The mode decides which battery size is honest.
  const onset = view.result?.challenge_onset_index ?? null;
  const battery = (view.result?.mode ?? "passive") === "active" ? TOTALS.total : TOTALS.passive;
  return (
    <section className="report">
      {view.event && <EventCrumb slug={view.event.slug} />}
      <h1>
        {view.origin ?? view.url}
        <span className="tag">{view.result?.mode ?? "passive"}</span>
      </h1>
      <div className="challenge-note withheld" role="status">
        <p className="challenge-head">No score (withheld grade)</p>
        <p>
          {onset
            ? `A bot challenge stopped the grade at check ${onset} of ${battery}.`
            : "A bot challenge stopped the grade before any check ran."}
        </p>
        <p className="fineprint">
          {view.event?.paused ? (
          <>
            Paused. The retry runs when grading resumes.
            <ResumeRun event={view.event} onResumed={onResume} />
          </>
        ) : (
          (retry ?? "Grading again later may get through.")
        )}
        </p>
      </div>
      <ReportKeep view={view} />
    </section>
  );
}

/** A grade that DID run but had part of its tail blocked mid-way. The score stands for what ran; the
 *  note keeps a blocked axis from reading as a clean one and says a retry is coming. Renders nothing
 *  when no probe was ever blocked, which is the ordinary case; when a pass recovered one, the note
 *  stays, because a clean report that was provisional yesterday should say so. */
function ChallengeNote({
  blocked,
  retryDueAt,
  retryPasses,
  initial,
  now,
  event,
  onResume,
}: {
  blocked: string[];
  retryDueAt?: string | null;
  retryPasses?: number;
  /** How many were blocked when recovery began, so a partial recovery reads as "recovered P of M". */
  initial?: number | null;
  now: number;
  event?: GradeView["event"];
  onResume: () => void;
}) {
  if (!blocked || blocked.length === 0) {
    // Fully recovered: the pass cleared every blocked check, so the report reads clean and this is
    // the only trace that part of the battery ran later than the rest of it.
    if ((retryPasses ?? 0) > 0 && (initial ?? 0) > 0) {
      return (
        <div className="challenge-note" role="status">
          <p className="challenge-head">Recovered all {initial} checks a bot challenge blocked.</p>
        </div>
      );
    }
    return null;
  }
  const retry = retryStatus(retryDueAt, retryPasses, blocked.length, now);
  const remaining = blocked.length;
  const cats = blockedCategories(blocked);

  // After a pass, the head says how much came back and the fineprint says what happens next: the
  // count and the timing are the whole message, no explanatory second clause.
  const attempted = (retryPasses ?? 0) > 0 && initial != null;
  if (attempted) {
    const recovered = Math.max(0, (initial as number) - remaining);
    const cats = blockedCategories(blocked);
    return (
      <div className="challenge-note" role="status">
        <p className="challenge-head">
          {recovered > 0
            ? `Recovered ${recovered} of ${initial} blocked checks.`
            : `None of the ${initial} blocked checks recovered yet.`}
        </p>
        {cats && <p className="fineprint">Still blocked: {cats}.</p>}
        {event?.paused ? (
          <p className="fineprint">
            Paused. The retry runs when grading resumes.
            {event && <ResumeRun event={event} onResumed={onResume} />}
          </p>
        ) : (
          retry && <p className="fineprint">{retry}</p>
        )}
      </div>
    );
  }
  return (
    <div className="challenge-note" role="status">
      <p className="challenge-head">
        A challenge interrupted {remaining} {remaining === 1 ? "check" : "checks"}.
      </p>
      {cats ? <p>Blocked: {cats}.</p> : <p>The app&apos;s protection blocked part of the run.</p>}
      {event?.paused ? (
        <p className="fineprint">
          Paused. The retry runs when grading resumes.
          {event && <ResumeRun event={event} onResumed={onResume} />}
        </p>
      ) : (
        retry && <p className="fineprint">{retry}</p>
      )}
    </div>
  );
}

function ReportKeep({ view }: { view: GradeView }) {
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm("Delete this report? This cannot be undone.")) return;
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
  // Someone else's saved report: it does not expire, and the delete button would only 403. The
  // report itself stays readable, this footer just has nothing true to say about it.
  if (known && view.claimed && !view.mine) return null;

  return (
    <p className="report-keep">
      {known && view.claimed ? "Saved to your account." : null}
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

/** One evidence value as text, at any depth.
 *
 *  The old version called String() on nested values, so an object one level down rendered as
 *  "[object Object]" and the reader was shown the word Object where a number should have been. Axe
 *  evidence nests two deep (impacts inside an advisory block), which is exactly where it showed. */
function fmtValue(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => fmtValue(x, depth + 1)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const inner = Object.entries(v as Record<string, unknown>).filter(
      ([, iv]) => iv !== null && iv !== undefined && iv !== ""
    );
    if (inner.length === 0) return "";
    // Deep enough that a prose rendering stops helping; show the shape instead of losing it.
    if (depth >= 2) return JSON.stringify(v);
    return inner.map(([ik, iv]) => `${ik.replace(/_/g, " ")} ${fmtValue(iv, depth + 1)}`).join(", ");
  }
  return String(v);
}

function evidencePairs(ev?: Record<string, unknown>): [string, string][] {
  if (!ev) return [];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(ev)) {
    if (EVIDENCE_SKIP.has(k) || v === null || v === undefined) continue;
    const text = fmtValue(v);
    if (text === "") continue;
    out.push([k, text]);
  }
  return out;
}

/** What the placement is made of.
 *
 *  Two apps can score the same and place differently, which looks like a bug until you can see what
 *  separated them. The rank compares slop first, then whether a gating finding fired, then the worst
 *  single finding, then how much slop the app was exposed to and survived, then how many kinds of
 *  check applied. Every one of those is here. */
function RankDetail({ r }: { r: GradeResult }) {
  const rk = r.ranking;
  if (!rk) return null;
  const rep = (rk.reporting ?? {}) as Record<string, unknown>;
  const worst = Math.max(0, ...(r.findings ?? []).map((f) => f.penalty ?? 0));
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const potential = num(rk.slop_potential);
  const applicable = num(rep.probes_applicable);
  const cleanRate = num(rep.clean_rate);
  const untested = (rep.untested_families as string[] | undefined) ?? [];
  const limited = rep.status === "limited_engagement";

  return (
    <>
      <h2>How this ranks</h2>
      <p className="section-intro">
        Apps with the same score are tiebroken in this order: whether a catastrophic finding was
        found, then the worst single finding, then how much slop the app was exposed to, then how many
        kinds of checks applied.
      </p>
      <ul className="stat-list numeric">
        <li>
          <span className="k">{fmtScore(worst)}</span>
          <span className="v">
            worst single finding. Apps with worse single findings tend to have significant issues that
            degrade the user experience or allow bad actors easy unauthorized access.
          </span>
        </li>
        {/* Zero exposure is a real reading (nothing in the battery applied), and dividing by it
            printed Infinity%. There is no share to state, so the line stays out. */}
        {potential !== null && potential > 0 && (
          <li>
            <span className="k">{fmtScore(potential)}</span>
            <span className="v">
              slop this app was exposed to. It scored {fmtScore(Number(r.slop_score))} of that, which
              is {((Number(r.slop_score) / potential) * 100).toFixed(1)}%. More exposure survived ranks
              higher at the same score.
            </span>
          </li>
        )}
        {applicable !== null && (
          <li>
            <span className="k">{applicable}</span>
            <span className="v">
              checks applied out of the {r.passive_probe_count ?? TOTALS.passive} in this battery.
              {limited ? "*" : ""}
            </span>
          </li>
        )}
        {num(rk.categories_applied) !== null && (
          <li>
            <span className="k">{rk.categories_applied}</span>
            <span className="v">different faults were actually testable.</span>
          </li>
        )}
        {rep.attack_surface_coverage ? (
          <li>
            <span className="k">{String(rep.attack_surface_coverage)}</span>
            <span className="v">
              how much of the app&apos;s surface Sloptic could reach.
              {untested.length > 0 ? ` Nothing tested: ${untested.join(", ")}.` : ""}
            </span>
          </li>
        ) : null}
      </ul>
      {/* Only when it applies. A footnote explaining Limited Engagement under a grade that ran the
          whole battery is a note about something that did not happen. */}
      {limited && (
        <p className="section-intro fineprint">
          *Marked for limited engagement: too few checks applied for a fair read.
        </p>
      )}
    </>
  );
}

/** What discovery saw on the app: the routes it mapped, the forms and endpoints it found, and the
 *  capabilities it noticed. Collapsed by default; the numbers live in the summary, the lists inside.
 *  Routes are capped in the display because a big app's list can run hundreds deep. */
function Surface({ surface }: { surface: Record<string, unknown> | null }) {
  if (!surface || Object.keys(surface).length === 0) return null;
  const num = (k: string): number | null => (typeof surface[k] === "number" ? (surface[k] as number) : null);
  const routes = num("routes");
  const forms = num("forms");
  const endpoints = num("endpoints");
  const routesList = Array.isArray(surface.routes_list) ? (surface.routes_list as string[]) : [];
  const landingPath = typeof surface.landing_path === "string" ? surface.landing_path : null;
  const flags = (
    [
      ["login", surface.has_login],
      ["signup", surface.has_signup],
      ["upload", surface.has_upload],
      ["api", surface.has_api],
      ["password form", surface.has_password_form],
      ["text input", surface.accepts_text_input],
      ["catch-all routing", surface.catch_all],
    ] as [string, unknown][]
  )
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  if (routes === null && forms === null && endpoints === null && routesList.length === 0 && flags.length === 0)
    return null;

  // Pages and build output, apart. A reader opening this wants to know what of THEIR app was
  // reached; a list led by webpack chunks answers a question nobody asked. The grader now orders it
  // this way too, but a report has to read correctly against grades stored before that.
  const isBuildOutput = (r: string) =>
    /\/(?:_next|_nuxt|_astro|static|assets|build|dist)\/|\.(?:js|mjs|cjs|css|map|woff2?|ttf|eot|png|jpe?g|gif|svg|ico|webp|avif)$/i.test(r);
  const pages = routesList.filter((r) => !isBuildOutput(r));
  const assets = routesList.filter(isBuildOutput);
  const bits = [
    routes !== null ? `${routes} routes` : null,
    forms !== null ? `${forms} forms` : null,
    endpoints !== null ? `${endpoints} endpoints` : null,
    landingPath ? `entered at ${landingPath}` : null,
  ].filter(Boolean);

  return (
    <details className="surface-block">
      <summary className="surface-summary">
        <span className="surface-name">What Sloptic saw</span>
        <span className="surface-counts">{bits.join(", ")}</span>
      </summary>
      <div className="surface-body">
        {flags.length > 0 && <p className="surface-flags">Saw: {flags.join(", ")}</p>}
        {pages.length > 0 && (
          <>
            <p className="surface-flags">
              Pages{routesList.length < (routes ?? 0) ? ` (${pages.length} of ${routes} routes reached)` : ""}:
            </p>
            <ul className="surface-routes">
              {pages.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
        {assets.length > 0 && (
          // Folded away by default. These are real routes and the grade did fetch them, so hiding
          // them entirely would misrepresent the coverage, but nobody opens a report to read
          // bundle filenames.
          <details className="surface-assets">
            <summary>Build output and assets ({assets.length})</summary>
            <ul className="surface-routes">
              {assets.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}

function Findings({ findings, card }: { findings: Finding[]; card: Record<string, CardEntry> }) {
  if (findings.length === 0) {
    return (
      <>
        <h2>Failures</h2>
        <p className="passive-note">Nothing failed :)</p>
      </>
    );
  }
  // One flaw, one row. The same probe firing on eight paths is eight findings in the data but one
  // thing to fix, and listing it eight times was the single biggest reason this list looked like it
  // summed to twice the score. The grader takes the same view when scoring: repeats inside a
  // category decay hard, so the eighth instance is worth almost nothing.
  const groups = new Map<string, { f: Finding; targets: string[]; contribution: number }>();
  for (const f of findings) {
    const key = `${f.probe_id}::${f.reason ?? ""}`;
    const g = groups.get(key);
    if (g) {
      if (f.target) g.targets.push(f.target);
      // Contributions ADD across a collapsed row: the grader rounds them by largest remainder over
      // the whole list, so summing the members keeps the column landing on the score exactly.
      g.contribution += f.contribution ?? 0;
      if ((f.penalty ?? 0) > (g.f.penalty ?? 0)) g.f = f;
    } else {
      groups.set(key, {
        f,
        targets: f.target ? [f.target] : [],
        contribution: f.contribution ?? 0,
      });
    }
  }
  // Records written before sloptic 2.2.0 carry no contribution, and every grade stored today is one
  // of those. Detect that rather than rendering a column of zeros that claims to sum to the score.
  const scored = findings.every((f) => typeof f.contribution === "number");
  const sorted = [...groups.values()].sort((a, b) =>
    scored ? b.contribution - a.contribution : (b.f.penalty ?? 0) - (a.f.penalty ?? 0)
  );

  // One group per category, heaviest first; rows keep their order inside each group. No category
  // subtotal: repeats decay WITHIN a category, so a subtotal would invite summing that does not
  // hold, and the axis bars above remain the only honest decomposition.
  const cats: { slug: string; name: string; area: Area; items: typeof sorted; total: number }[] = [];
  const byCat = new Map<string, number>();
  for (const g of sorted) {
    const slug = g.f.category;
    const area = g.f.bundle as Area;
    let idx = byCat.get(slug);
    if (idx === undefined) {
      idx = cats.length;
      byCat.set(slug, idx);
      cats.push({ slug, name: categoryName(slug), area, items: [], total: 0 });
    }
    cats[idx].items.push(g);
    cats[idx].total += scored ? g.contribution : (g.f.penalty ?? 0);
  }
  cats.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return (
    <>
      <h2>What failed ({sorted.length})</h2>
      {/* Said before the list, because the numbers beside each row invite adding. On scored grades
          they are contributions: rows sum to their category header and the headers sum to the score.
          On grades recorded before contributions existed they are prices and do NOT sum; the axis
          subtotals above are the only exact split there. */}
      <p className="section-intro">Open a category for details.</p>
      <div className="sample-findings">
        {cats.map((cat) => (
          <details className="cat-group" data-axis={cat.area} key={cat.slug}>
            <summary className="cat-head">
              <span className="cat-arrow" aria-hidden>
                ▸
              </span>
              <span className="cat-title">
                {cat.name} <span className="cat-count">{cat.items.length}</span>
              </span>
              {scored && <span className="cat-score">{cat.total.toFixed(1)}</span>}
            </summary>
            {cat.items.map(({ f, targets, contribution }) => {
                const entry = card[f.probe_id];
                const ev = evidencePairs(f.evidence as Record<string, unknown> | undefined);
                return (
                  <details className="finding-detail" data-axis={f.bundle} key={`${f.probe_id}::${f.reason ?? ""}`}>
                    <summary className="finding-row">
                      <span className="finding-dot" />
                      <span className="finding-body">
                        <span className="finding-cat">{f.category}</span>
                        {f.reason && <span className="finding-desc">{f.reason}</span>}
                        <span className="finding-meta">
                          {[
                            f.probe_id,
                            targets.length > 1 ? `${targets.length} paths` : f.target,
                          ]
                            .filter(Boolean)
                            .join("  /  ")}
                        </span>
                      </span>
                      {/* The CONTRIBUTION, not the price, so the column is an honest addition. The two
                          are never shown side by side: four defense in depth probes are re-priced upward
                          when a vulnerability they would have contained also fires, so a row can
                          legitimately contribute more than its penalty, which reads as a bug next to
                          a column that claims to add up. */}
                      <span className="finding-pen">{scored ? contribution.toFixed(1) : f.penalty}</span>
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
          </details>
        ))}
      </div>
    </>
  );
}

type PassedItem = {
  id: string;
  area: Area;
  slug: string;
  name: string;
  evidence: Record<string, unknown>;
  targets: string[];
};

function Passed({ items }: { items: PassedItem[] }) {
  if (items.length === 0) return null;
  // One group per category, same shape as what failed. A row's own label IS its category, so
  // rows lead with the probe id, the per-check identity the index carries.
  const cats: { slug: string; name: string; area: Area; items: PassedItem[] }[] = [];
  const bySlug = new Map<string, number>();
  for (const p of items) {
    let idx = bySlug.get(p.slug);
    if (idx === undefined) {
      idx = cats.length;
      bySlug.set(p.slug, idx);
      cats.push({ slug: p.slug, name: p.name, area: p.area, items: [] });
    }
    cats[idx].items.push(p);
  }
  cats.sort(
    (a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) || a.name.localeCompare(b.name)
  );
  return (
    <>
      <h2>Passes ({items.length})</h2>
      <p className="section-intro">Open a category for what its checks measured.</p>
      <div className="sample-findings">
        {cats.map((cat) => (
          <details className="cat-group" data-axis={cat.area} key={cat.slug}>
            <summary className="cat-head">
              <span className="cat-arrow" aria-hidden>
                ▸
              </span>
              <span className="cat-title">
                {cat.name} <span className="cat-count">{cat.items.length}</span>
              </span>
            </summary>
            {cat.items.map((p) => {
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
          </details>
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
