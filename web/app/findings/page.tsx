import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { ACTIVE, GEMINI_LIVE_APPS, comparableEvents, MIN_EVENT_N, fmt } from "@/lib/corpus";
import EventSpread from "./EventSpread";
import Exploitable from "./Exploitable";

// Read from the corpus, like every other number on this page, so it moves when the corpus does.
export const metadata: Metadata = pageMeta(
  "What do hackathon apps look like?",
  `What Sloptic found when it graded ${ACTIVE.attrition.graded.toLocaleString("en-US")} apps in ${ACTIVE.provenance.n_events} hackathons.`,
  "/findings",
);

const D = ACTIVE.distribution;
const SEV = ACTIVE.severity;
const W = ACTIVE.winners;
const A = ACTIVE.attrition;
const STAR = ACTIVE.star_finding;
const RHO = ACTIVE.axis_independence;

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
          {/* Every 50 up to the last bin, not a fixed list. The 3.0 corpus runs to 337.5, and ticks
              that stopped at 200 left the right third of the axis unlabelled. */}
          {Array.from({ length: Math.floor((bins[bins.length - 1][1] || 0) / 50) + 1 }, (_, i) => i * 50)
            .filter((v) => x(v) < W_ - 60)
            .map((v) => (
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
        <h1>What do hackathon apps look like?</h1>
        <p className="page-lead">
          When Sloptic graded {A.graded.toLocaleString()} apps in {ACTIVE.provenance.n_events} hackathons, it found that...
        </p>
      </div>

      <section className="section attached">
        <h2 className="section-head">Nothing is clean</h2>
        <p className="section-intro">
          The median is {fmt(D.median)}, and a
          quarter scored above {fmt(D.q3)}.{" "}
          {/* Read from the corpus. It said "Only one scored 0", which was true of 2026.3 and is false
              of 2026.4: no app scored 0, and the cleanest scored 1. */}
          {A.clean_zero === 0
            ? `No app scored 0 and the cleanest scored ${fmt(D.min)}.`
            : `Only ${A.clean_zero.toLocaleString()} scored 0.`}{" "}
          In other words, there is slop in every app.
        </p>
        <Histogram />
        <h2 className="section-head">
          More stats
        </h2>
        <ul className="stat-list numeric">
          <li>
            <span className="k"><b>{fmt(D.mean)}</b></span>
            <span className="v">average slop</span>
          </li>
          <li> 
            <span className="k"><b>{fmt(D.stdev)}</b></span>
            <span className="v">standard deviation</span>
          </li>
          <li>
            <span className="k"><b>{fmt(D.max)}</b></span>
            <span className="v">worst app</span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">What was the slop like?</h2>
        <p className="section-intro">
          Different slop have different severities. While most are chronic and indicative of hygiene, 
          quite a few apps have serious or even critical problems. The table below shows the 
          number of instances of slop of each kind and how many apps have what:
        </p>
        <Bands />
        <br />
        <p className="section-intro">
          When evaluated on its single worst slop instance, this is what apps had:
        </p>
        <Levels />
      </section>

      <section className="section">
        {/* Rewritten for the 3.0 corpus. It used to read "Winners ship more slop?!" and say the opposite
            of cleanliness "tends to be true", but the median gap is not significant (p = 0.22), and
            winners crash, leak and ship dead controls at the same rates. The only real difference is
            performance. It also said winners ship more features and so more surface to get wrong; the
            3.0 corpus measures their observed surface as the same size (p = 0.70).
            Source: sloptic-main CORPUS_REPORT.md 4.7. The p values are transcribed from there because
            the figures file does not carry them; every other number here is read from the file. */}
        <h2 className="section-head">Are winners cleaner?</h2>
        <p className="section-intro">
          No, but not dirtier either. Winning apps carry a median slop of {fmt(W.winner.median)} against{" "}
          {fmt(W.non_winner.median)} for everyone else, which can be chalked up to chance (p = 0.22). Winners' apps
          crash, leak secrets and have nonfunctioning buttons at the same rates as everyone else.
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
          But speed does differ, as winning apps are heavier and hence score lower on Lighthouse
          (p = 0.003):
        </p>
        <div className="versus">
          <div className="versus-side" data-side="winner">
            <span className="versus-num"><b>{fmt(ACTIVE.lighthouse.winners.median)}</b></span>
            <span className="versus-cap">median Lighthouse score, winners</span>
            <span className="versus-n">{ACTIVE.lighthouse.winners.n} apps</span>
          </div>
          <div className="versus-side">
            <span className="versus-num">{fmt(ACTIVE.lighthouse.non_winners.median)}</span>
            <span className="versus-cap">median Lighthouse score, everyone else</span>
            <span className="versus-n">{ACTIVE.lighthouse.non_winners.n.toLocaleString()} apps</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">Are faster apps cleaner?</h2>
        <p className="section-intro">
          Not exactly. When we measured performance (via Lighthouse) against the slop without the performance
          axis, the correlation is {RHO.perf_vs_nonperf_slop_rho} across{" "} the
          {RHO.n.toLocaleString()} apps, which is close enough to zero to call the two independent.
        </p>
        <ul className="stat-list numeric">
          <li>
            <span className="k"><b>{RHO.perf_vs_nonperf_slop_rho}</b></span>
            <span className="v">
              Spearman correlation between Lighthouse performance and the rest of the slop
            </span>
          </li>
        </ul>
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
        <h2 className="section-head">How many are exploitable?</h2>
        <p className="section-intro">
          Yet only {fmt(SEV.exploitable_pct)}% of apps had an exploitable vulnerability. The largest class is
          a credential in the bundle, most often ({GEMINI_LIVE_APPS} apps) a Google API key
          that can call the Gemini API. Next is an open Supabase or Firebase database, as {STAR.apps} apps
          lacked row level security which allowed an anonymous client to read or write rows. See the table below
          for details:
        </p>
        <Exploitable />
      </section>

      <section className="section">
        <h2 className="section-head">What didn't get graded</h2>
        <p className="section-intro">
          Sloptic attempted {A.attempted.toLocaleString()} apps and graded{" "}
          {A.graded.toLocaleString()} of them, or {fmt(A.graded_pct)}%. Most of the rest
          were due to link rot (expired free tier), timeouts, a WAF/bot challenge, or other reasons.
        </p>
        <div className="table-scroll">
          <table className="count-table">
            <thead>
              <tr>
                <th>no grade reason</th>
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
          Sloptic is currently unable to properly separate what the teams built from these platforms.
        </p>
      </section>
    </>
  );
}
