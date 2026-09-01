import type { Metadata } from "next";
import { ACTIVE, comparableEvents, MIN_EVENT_N, fmt } from "@/lib/corpus";

export const metadata: Metadata = {
  title: "What 1,625 hackathon apps looked like",
  description:
    "The corpus study behind Sloptic: how deep the durability floor goes, why human judging misses it, and how much events differ.",
};

const D = ACTIVE.distribution;
const SEV = ACTIVE.severity;
const W = ACTIVE.winners;
const A = ACTIVE.attrition;
const STAR = ACTIVE.star_finding;

/** Slop across the corpus. One series, so no legend: the heading names it. Direct labels sit on the
 *  landmarks only, never on every bar, and each bar carries a <title> so a reader can hover for the
 *  exact count without the page shipping a tooltip runtime. */
function Histogram() {
  const bins = D.bins as [number, number, number][];
  const peak = Math.max(...bins.map((b) => b[2]));
  const W_ = 720;
  const H = 200;
  const gap = 2; // the 2px surface gap between adjacent fills
  const bw = W_ / bins.length;
  const x = (v: number) => (v / (bins[bins.length - 1][1] || 1)) * W_;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W_} ${H + 34}`} role="img"
           aria-label={`Histogram of slop scores across ${D.n} apps. Median ${D.median}, quartiles ${D.q1} and ${D.q3}, maximum ${D.max}.`}>
        {bins.map(([lo, hi, n]) => {
          const h = (n / peak) * H;
          return (
            <g key={lo}>
              <title>{`${lo} to ${hi}: ${n} apps`}</title>
              <rect x={x(lo) + gap / 2} y={H - h} width={bw - gap} height={h} rx="3" className="bar" />
            </g>
          );
        })}
        <line x1="0" y1={H} x2={W_} y2={H} className="axis" />
        {/* Landmarks, because the shape only means something against them. */}
        <g className="landmark">
          <line x1={x(D.median)} y1="0" x2={x(D.median)} y2={H} />
          <text x={x(D.median) + 6} y="14">median {fmt(D.median)}</text>
        </g>
        <g className="landmark soft">
          <line x1={x(D.q3)} y1="20" x2={x(D.q3)} y2={H} />
          <text x={x(D.q3) + 6} y="34">upper quarter starts at {fmt(D.q3)}</text>
        </g>
        <g className="tick">
          {[0, 50, 100, 150, 200].map((v) => (
            <text key={v} x={x(v)} y={H + 20}>{v}</text>
          ))}
          <text x={W_} y={H + 20} textAnchor="end">slop score</text>
        </g>
      </svg>
    </figure>
  );
}

/** The three levels are CUMULATIVE subsets, not parts of a whole, so they are drawn nested rather
 *  than stacked. A stacked bar would silently claim they sum to the population, and they do not:
 *  every acute app is also a significant one. */
function Levels() {
  const rows = [
    ...SEV.levels.map((l) => ({ key: l.key, label: l.label, pct: l.pct, apps: l.apps,
                                threshold: l.threshold, definition: l.definition })),
    { key: "exploitable", label: "Exploitable", pct: SEV.exploitable_pct, apps: SEV.exploitable_apps,
      threshold: "carries a catastrophe gate finding", definition: SEV.exploitable_definition },
  ].sort((a, b) => b.pct - a.pct);

  return (
    <ul className="levels">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="level-head">
            <span className="level-name">{r.label}</span>
            <span className="level-pct">{fmt(r.pct)}%</span>
            <span className="level-n">{r.apps.toLocaleString()} apps</span>
          </div>
          <div className="level-track" role="img" aria-label={`${fmt(r.pct)} percent`}>
            <span className="level-fill" data-level={r.key} style={{ width: `${r.pct}%` }} />
          </div>
          <p className="level-def">{r.definition}</p>
        </li>
      ))}
    </ul>
  );
}

/** Event medians, sorted. The claim is about the SPREAD, so the chart is the spread: one mark per
 *  event, the ends labelled, nothing in between labelled at all. */
function EventSpread() {
  const events = comparableEvents();
  const hi = events[0];
  const lo = events[events.length - 1];
  const max = Math.max(...events.map((e) => e.median));
  return (
    <figure className="chart">
      <svg viewBox={`0 0 720 ${events.length * 7 + 26}`} role="img"
           aria-label={`Median slop for each of ${events.length} events, from ${fmt(lo.median)} to ${fmt(hi.median)}.`}>
        {events.map((e, i) => (
          <g key={e.event}>
            <title>{`${e.event}: median ${fmt(e.median)} across ${e.n} apps`}</title>
            <rect x="0" y={i * 7} width={(e.median / max) * 720} height="5" rx="2.5" className="bar" />
          </g>
        ))}
        <g className="tick">
          <text x="0" y={events.length * 7 + 18}>
            each row is one event, sorted by median. {events.length} events with {MIN_EVENT_N} or more graded apps.
          </text>
        </g>
      </svg>
    </figure>
  );
}

export default function FindingsPage() {
  const events = comparableEvents();
  const spread = events[0].median / events[events.length - 1].median;

  return (
    <>
      <div className="page-head">
        <h1>What 1,625 hackathon apps looked like</h1>
        <p className="page-lead">
          Every app in {ACTIVE.provenance.n_events} hackathons, graded the same way, with no source
          and no spec. This is the evidence that the durability floor is worth a prize of its own.
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">Almost nothing is clean</h2>
        <p className="section-intro">
          One app out of {D.n.toLocaleString()} scored 0. The median scored {fmt(D.median)}, and a
          quarter of the field scored above {fmt(D.q3)}. The floor is not a tail of bad apps, it is
          where the field lives.
        </p>
        <Histogram />
        <ul className="stat-list numeric">
          <li>
            <span className="k">{A.clean_zero}</span>
            <span className="v">app scored 0 out of {D.n.toLocaleString()} graded, so a clean grade is the exception, not the baseline.</span>
          </li>
          <li>
            <span className="k">{fmt(D.median)}</span>
            <span className="v">median slop, against a scale where a lower number is better and 0 means nothing was found.</span>
          </li>
          <li>
            <span className="k">{fmt(D.max)}</span>
            <span className="v">the worst app graded, roughly {(D.max / D.median).toFixed(0)} times the median.</span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">Broken far more often than hackable</h2>
        <p className="section-intro">
          Sorting each app by its single worst finding gives three levels. They are cumulative, so
          every acute app is also a significant one.
        </p>
        <Levels />
        <p className="section-intro">
          The middle band is the one that should bother a judge. Almost nothing in it has an excuse in
          a hackathon that ran more than a day with an AI on hand: a dead control, a broken link, or a
          page slow enough to notice is a couple of prompts to fix, and it ships because the demo never
          exercised it.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Winners ship more slop</h2>
        <p className="section-intro">
          Apps that won something carry a {fmt(W.delta_pct)}% higher median slop than apps that did
          not. Human judging is not failing here, it is measuring something else: the idea, the pitch,
          the demo. Nothing in a five minute demo exercises the parts Sloptic reads.
        </p>
        <div className="versus">
          <div className="versus-side" data-side="winner">
            <span className="versus-num">{fmt(W.winner.median)}</span>
            <span className="versus-cap">median slop, winners</span>
            <span className="versus-n">{W.winner.n} apps</span>
          </div>
          <div className="versus-side">
            <span className="versus-num">{fmt(W.non_winner.median)}</span>
            <span className="versus-cap">median slop, everyone else</span>
            <span className="versus-n">{W.non_winner.n.toLocaleString()} apps</span>
          </div>
        </div>
        <p className="section-intro">
          It holds on performance too. Winners have a median Lighthouse performance score of{" "}
          {ACTIVE.lighthouse.winners.median} against {ACTIVE.lighthouse.non_winners.median} for
          everyone else, measured by a pinned local Lighthouse rather than anything hand rolled.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Events differ by more than threefold</h2>
        <p className="section-intro">
          Across the {events.length} events with {MIN_EVENT_N} or more graded apps, median slop runs
          from {fmt(events[events.length - 1].median)} to {fmt(events[0].median)}, a spread of{" "}
          {spread.toFixed(1)} times. Whatever an event does to its field, it is doing something, and
          right now nobody measures it.
        </p>
        <EventSpread />
        <p className="section-intro fineprint">
          Events with fewer than {MIN_EVENT_N} graded apps are left out. A median over one or two apps
          is not a comparison, and charting it would invent a difference.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">The exploitable slice is thin and real</h2>
        <p className="section-intro">
          Only {fmt(SEV.exploitable_pct)}% of apps carry something an attacker could use today. The
          largest single class is a managed backend left open: {STAR.apps} apps served a Supabase or
          Firebase database that anyone could read, because row level security was never switched on.
          Of those, {STAR.breakdown.bulk_records} returned records in bulk and{" "}
          {STAR.breakdown.with_pii_columns} held columns of personal data.
        </p>
        <div className="callout" data-tone="warn">
          <p className="callout-label">what this needs</p>
          <p>
            Finding an open backend takes an active check, which Sloptic runs only for an event whose
            organizer has verified it, or an owner who has verified their own domain. The anonymous
            tier never runs it, so a clean passive grade is not evidence that a backend is closed.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">What did not get graded</h2>
        <p className="section-intro">
          Sloptic attempted {A.attempted.toLocaleString()} apps and graded{" "}
          {A.graded.toLocaleString()} of them, {fmt(A.graded_pct)}%. The gap is mostly link rot, since
          this corpus reaches back through old events. An app graded at judging time, while it is still
          deployed, fares far better.
        </p>
        <div className="table-scroll">
          <table className="count-table">
            <thead>
              <tr>
                <th>why an app was not graded</th>
                <th>apps</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(A.dnf_by_reason).map(([reason, n]) => (
                <tr key={reason}>
                  <th scope="row">{reason}</th>
                  <td>{(n as number).toLocaleString()}</td>
                </tr>
              ))}
              <tr className="total-row">
                <th scope="row">not graded</th>
                <td>{A.dnf.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="section-intro fineprint">
          {ACTIVE.by_stack_excluded.map((s) => `${s.apps} ${s.stack} apps`).join(", ")} are excluded
          from the per stack comparison: the grade measures the framework those apps are hosted in
          rather than the app itself, so their score describes the host and would read as a clean
          result when it is really an unmeasurable one.
        </p>
      </section>

      <div className="method" data-tone="limits">
        <h2>How to read this</h2>
        <p>
          <b>Every figure here is an aggregate.</b> No app is named, no URL appears, and no row
          describes one team. The apps in this study were graded to build the ruler, not to be
          published.
        </p>
        <p>
          <b>These are the full grade numbers.</b> {ACTIVE.provenance.n_probes} checks, run against a
          corpus, ranked on curve {ACTIVE.provenance.curve_version}. An anonymous grade on sloptic.org
          runs the passive floor instead, which is a different and smaller measurement.
        </p>
        <div className="cta-row">
          <a className="button" href="/organizers">
            Sloptic for organizers
          </a>
          <a className="button secondary" href="https://github.com/sloptic/sloptic-main/blob/main/CORPUS_REPORT.md">
            The full study
          </a>
        </div>
      </div>
    </>
  );
}
