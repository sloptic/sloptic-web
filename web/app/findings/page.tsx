import type { Metadata } from "next";
import { ACTIVE, comparableEvents, MIN_EVENT_N, fmt } from "@/lib/corpus";
import EventSpread from "./EventSpread";

export const metadata: Metadata = {
  title: "What hackathon apps looked like",
  description:
    "The corpus study behind Sloptic, why human judging misses it, and how much events differ.",
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
          <text x={x(D.q3) + 6} y="34">Q3 at {fmt(D.q3)}</text>
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

/** The five penalty bands, which unlike the levels ARE a partition, but only of FINDINGS.
 *
 *  This is the distinction the section turns on. Every finding is priced once, so it falls in exactly
 *  one band and the shares sum to 100. Apps do not partition: an app with a critical and a moderate
 *  finding is counted in both bands, and those columns sum to 222% of the corpus. So the bar is drawn
 *  on findings, and the app column is labelled "at least one" rather than left to be read as a share
 *  of anything. */
const BAND_ORDER = ["minor", "moderate", "serious", "severe", "critical"] as const;

function Bands() {
  const tiers = SEV.tiers as Record<string, { findings: number; apps: number; pct_apps: number }>;
  const total = BAND_ORDER.reduce((n, k) => n + tiers[k].findings, 0);
  const peak = Math.max(...BAND_ORDER.map((k) => tiers[k].findings));

  return (
    <div className="table-scroll">
      <table className="band-table">
        <thead>
          <tr>
            <th>penalty</th>
            <th>band</th>
            <th colSpan={2}>findings</th>
            <th>share</th>
            <th>apps with at least one</th>
          </tr>
        </thead>
        <tbody>
          {BAND_ORDER.map((k) => {
            const t = tiers[k];
            return (
              <tr key={k}>
                <th scope="row">{SEV.tier_bands[k as keyof typeof SEV.tier_bands]}</th>
                <td className="band-name">{k}</td>
                <td className="band-bar">
                  <span style={{ width: `${(t.findings / peak) * 100}%` }} data-band={k} />
                </td>
                <td>{t.findings.toLocaleString()}</td>
                <td>{((t.findings / total) * 100).toFixed(1)}%</td>
                <td>
                  {t.apps.toLocaleString()}{" "}
                  <span className="band-pct">({t.pct_apps.toFixed(1)}%)</span>
                </td>
              </tr>
            );
          })}
          <tr className="total-row">
            <th scope="row">all</th>
            <td />
            <td />
            <td>{total.toLocaleString()}</td>
            <td>100%</td>
            <td className="band-note">(these overlap)</td>
          </tr>
        </tbody>
      </table>
    </div>
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

export default function FindingsPage() {
  const events = comparableEvents();
  const spread = events[0].median / events[events.length - 1].median;

  return (
    <>
      <div className="page-head">
        <h1>What hackathon apps look like</h1>
        <p className="page-lead">
          The results of 1,625 apps in {ACTIVE.provenance.n_events} hackathons graded objectively
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">Almost nothing is clean</h2>
        <p className="section-intro">
          Only one app scored 0. The median is {fmt(D.median)}, and a
          quarter scored above {fmt(D.q3)}. In other words, there is something wrong with almost every app.
        </p>
        <Histogram />
        <h2 className="section-head">
          More stats
        </h2>
        <ul className="stat-list numeric">
          <li>
            <span className="k"><b>{fmt(D.mean)}</b></span>
            <span className="v">average slop.</span>
          </li>
          <li> 
            <span className="k"><b>{fmt(D.stdev)}</b></span>
            <span className="v">standard deviation.</span>
          </li>
          <li>
            <span className="k"><b>{fmt(D.max)}</b></span>
            <span className="v">the worst app.</span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">What kinds of problems do apps have?</h2>
        <p className="section-intro">
          Findings have various different severities. While most are chronic, a nontrivial number
          of apps have serious, severe, or even critical problems. The table below shows the 
          number of findings of each kind as well as how many apps have at least one of them.
        </p>
        <Bands />
        <br />
        <p className="section-intro">
          Grading an app by its single worst finding gives the stats below. Each one contains the
          ones under it, so almost 3 in 5 projects carry a significant problem and virtually every app
          overlooks some hygiene. 
        </p>
        <p className="section-intro">
          <em>(A significant problem has a penalty more than 20, and an acute problem
          has a penalty of more than 40.)</em>
        </p>
        <Levels />
      </section>

      <section className="section">
        <h2 className="section-head">Winners ship more slop</h2>
        <p className="section-intro">
          Counterintuitively, winning apps have {fmt(W.delta_pct)}% <em>higher</em> median slop than the rest.
        </p>
        <div className="versus">
          <div className="versus-side" data-side="winner">
            <span className="versus-num"><b>{fmt(W.winner.median)}</b></span>
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
          The same is true for Lighthouse:
        </p>
        <div className="versus">
          <div className="versus-side" data-side="winner">
            <span className="versus-num"><b>{fmt(ACTIVE.lighthouse.winners.median)}</b></span>
            <span className="versus-cap">median Lighthouse score, winners</span>
            <span className="versus-n">{W.winner.n} apps</span>
          </div>
          <div className="versus-side">
            <span className="versus-num">{fmt(ACTIVE.lighthouse.non_winners.median)}</span>
            <span className="versus-cap">median Lighthouse score, everyone else</span>
            <span className="versus-n">{W.non_winner.n.toLocaleString()} apps</span>
          </div>
        </div>
        <p className="section-intro">
          As you can see, winning does not correlate with app cleanliness. In fact, the opposite tends to be true.
          Most hackathons employ human judging, which rewards ideas, features, presentation, and the demo over durability.
          Winning apps tend to ship more features, meaning more surfaces to misconfigure or get wrong, and human judges do not 
          have time to judge quality over hundreds of apps.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Breakdown per hackathon</h2>
        <p className="section-intro">
          Across {events.length} hackathons out of {ACTIVE.provenance.n_events} with {MIN_EVENT_N} or more graded apps, median slop runs
          from {fmt(events[events.length - 1].median)} to {fmt(events[0].median)}, a {" "}
          {spread.toFixed(1)}x difference. Hover over a bar for the event in question.
        </p>
        <EventSpread events={events} minN={MIN_EVENT_N} />
      </section>

      <section className="section">
        <h2 className="section-head">Yet exploits are rare</h2>
        <p className="section-intro">
          Only {fmt(SEV.exploitable_pct)}% of apps carry something an attacker could use today. The
          largest single finding is an exposed backend, with {STAR.apps} apps serving a Supabase or
          Firebase database that anyone could read, because row level security was not turned on.
          Of those, {STAR.breakdown.bulk_records} returned records in bulk and{" "}
          {STAR.breakdown.with_pii_columns} held personal data in its columns.
        </p>
        <div className="callout" data-tone="warn">
          <p className="callout-label">what this needs</p>
          <p>
            Note that to find an exposed backend or other exploitable vulnerability, Sloptic must grade 
            actively. Grading passively holds back active attacks, at the cost of missing exploitable findings.
            To grade actively, verify your domain or event.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">What didn't get graded</h2>
        <p className="section-intro">
          Sloptic attempted {A.attempted.toLocaleString()} apps and graded{" "}
          {A.graded.toLocaleString()} of them, or {fmt(A.graded_pct)}%. Most of the rest
          were due to link rot (expired free tier), timeouts, a WAF challenge, or other reasons.
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
          Also excluded are {ACTIVE.by_stack_excluded.map((s) => `${s.apps} ${s.stack} apps`).join(", ")} since
          Sloptic is unable to properly separate what the teams built from the platform.
        </p>
      </section>

      <div className="method" data-tone="limits">
        <h2>How to read this</h2>
        <p>
          Every figure here is an aggregate. 
          No apps were named to protect the privacy of individual teams that built them.
          The apps in this study were graded as a calibration to build Sloptic itself.
        </p>
        <p>
          These are the full grade numbers that comprise the corpus used for percentile ranking on 
          active grades. A separate curve exists for passive grading.
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
