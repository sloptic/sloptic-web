import type { Metadata } from "next";
import { IBM_Plex_Serif } from "next/font/google";
import { pageMeta } from "@/lib/meta";
import { ACTIVE, GEMINI_LIVE_APPS, fireRate, comparableEvents, MIN_EVENT_N, fmt } from "@/lib/corpus";
import { PROBE_FACTS, probeName } from "@/lib/checks";
import { Reveal } from "./Showcase";
import Scrolly from "./Scrolly";

// /findings told as an investigation, for presenting live: a news-style article where two charts stay
// pinned while the paragraphs scroll past and change them (The Pudding's sticky graphic). Same corpus
// and wording as /findings, full grades only (the p values and transcribed figures exist for full grades
// alone), numbers rounded for a room. Kept out of search and the menus: /findings is the page of record.
export const metadata: Metadata = {
  ...pageMeta(
    "What do real apps miss?",
    `What Sloptic found when it graded ${ACTIVE.attrition.graded.toLocaleString("en-US")} apps in ${ACTIVE.provenance.n_events} hackathons.`,
    "/findings-demo",
  ),
  robots: { index: false, follow: false },
};

// The serif sets the page apart as an article while staying in the site's Plex family.
const serif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});

const F = ACTIVE;
const r0 = (n: number) => Math.round(n);

/** Slop across the corpus, bars growing from the axis as it scrolls in. */
function Histogram() {
  const D = F.distribution;
  const bins = D.bins as [number, number, number][];
  const peak = Math.max(...bins.map((b) => b[2]));
  const W = 720;
  const H = 200;
  const bw = W / bins.length;
  const x = (v: number) => (v / (bins[bins.length - 1][1] || 1)) * W;
  return (
    <svg className="sc-hist" viewBox={`0 0 ${W} ${H + 30}`} role="img"
         aria-label={`Histogram of slop scores across ${D.n} apps, median ${fmt(D.median)}.`}>
      {bins.map(([lo, , n], i) => {
        const h = (n / peak) * H;
        return (
          <rect key={lo} x={x(lo) + 1} y={H - h} width={bw - 2} height={h} rx="2"
                style={{ ["--bd" as string]: `${i * 20}ms` }} />
        );
      })}
      <line x1="0" y1={H} x2={W} y2={H} className="sc-axis" />
      <line x1={x(D.median)} y1="0" x2={x(D.median)} y2={H} className="sc-median" />
      <text x={x(D.median) + 8} y="14" className="sc-label">median {r0(D.median)}</text>
      <text x={W} y={H + 24} textAnchor="end" className="sc-label">slop score</text>
    </svg>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="story-section" id={id}>
      <h2 className="story-h2">{title}</h2>
      {children}
    </section>
  );
}

export default function FindingsDemoPage() {
  const D = F.distribution;
  const A = F.attrition;
  const W = F.winners;
  const SEV = F.severity;
  const LH = F.lighthouse;
  const STAR = F.star_finding;
  type BuilderRow = { builder: string; n: number; median: number };
  const builder = (name: string) =>
    ((F as { by_builder?: BuilderRow[] }).by_builder ?? []).find((b) => b.builder === name) ?? { builder: name, n: 0, median: 0 };
  const events = comparableEvents(MIN_EVENT_N, "active");
  const spread = events[0].median / events[events.length - 1].median;
  const graded = `${(Math.floor(A.graded / 100) * 100).toLocaleString("en-US")}+`;
  const csp = r0(fireRate("sec-headers-002") ?? 0);
  const a11y = r0(fireRate("qa-a11y-001") ?? 0);
  const slow = r0(fireRate("perf-lighthouse-001") ?? 0);
  const common = [...F.fire_frequency]
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6)
    .map((r) => {
      const f = PROBE_FACTS.find((x) => x.id === r.probe_id);
      return { label: f ? probeName(f).replace(/`/g, "") : r.probe_id, pct: r.pct, hot: r.bundle === "accessibility" || r.bundle === "performance" };
    });

  return (
    <article className={`story ${serif.variable}`}>
      <header className="story-head">
        <p className="story-kicker">Sloptic findings</p>
        <h1 className="story-h1">Sloptic graded {graded} real apps, and not one was clean</h1>
        <p className="story-dek">
          What Sloptic found when it graded apps from {F.provenance.n_events} hackathons: the slop teams miss, who
          ships it, and whether winning makes a difference.
        </p>
        <p className="story-byline">By Ian Sun · October 7, 2026</p>
      </header>

      <aside className="story-key">
        <p className="story-key-head">Key findings</p>
        <ul>
          <li>Not one of the {graded} apps scored a clean 0.</li>
          <li>{csp}% have no content security policy, and {a11y}% have an accessibility barrier.</li>
          <li>AI-built apps left their database open about 22 times as often as hand built ones.</li>
          <li>Hackathon winners are no cleaner than everyone else, and their apps are heavier.</li>
        </ul>
      </aside>

      <Section id="clean" title="Nothing is clean">
        <p className="story-p story-lede">
          Sloptic graded {graded} apps from {F.provenance.n_events} hackathons with all of its checks. The median
          scored {r0(D.median)}, and a quarter scored above {r0(D.q3)}. No app scored 0, and the cleanest
          scored {r0(D.min)}. In other words, there is slop in every app.
        </p>
        <Reveal>
          <figure className="story-fig">
            <figcaption className="story-figcap">Slop scores across {graded} apps. Lower is better.</figcaption>
            <Histogram />
          </figure>
        </Reveal>
      </Section>

      <Section id="miss" title="What do teams miss?">
        <p className="story-p">
          The most common kinds of slop are missing security headers, accessibility issues, and slow performance.
          Most are invisible to the teams building the apps.
        </p>
        <p className="story-p">
          {a11y}% of apps have an accessibility barrier, and about 4 in 5 of those have low contrast text. {slow}% score
          below 90 on Lighthouse, with a median of {r0(LH.overall.median)}.
        </p>
        <Reveal>
          <figure className="story-fig">
            <figcaption className="story-figcap">The most common slop, by share of apps</figcaption>
            <div className="sbars">
              {common.map((c, i) => (
                <div className="sbar" data-hot={c.hot ? "" : undefined} key={c.label}>
                  <span className="sbar-who">{c.label}</span>
                  <span className="sbar-track">
                    <span className="sbar-fill grow" style={{ width: `${c.pct}%`, ["--bd" as string]: `${i * 120}ms` }} />
                  </span>
                  <span className="sbar-num">{r0(c.pct)}%</span>
                </div>
              ))}
            </div>
          </figure>
        </Reveal>
      </Section>

      <Section id="ai-builders" title="Are AI-built apps sloppier?">
        <Scrolly
          steps={[
            {
              text: `Not overall. Lovable apps carry a median slop of ${r0(builder("lovable").median)} against ${r0(builder("hand built").median)} for hand built apps, a gap small enough to be chance.`,
              chart: "median slop, lower is better",
              max: 60,
              rows: [
                { who: "Lovable", v: builder("lovable").median, show: String(r0(builder("lovable").median)), hot: true },
                { who: "hand built", v: builder("hand built").median, show: String(r0(builder("hand built").median)) },
              ],
            },
            {
              text: "Backends make up the difference, as Lovable and Bolt both offer Supabase as a built in database and AIs rarely configure it properly.",
              chart: "left their database open",
              max: 15,
              rows: [
                { who: "Lovable and Bolt", v: 13.4, show: "13%", hot: true },
                { who: "hand built", v: 0.6, show: "under 1%" },
              ],
            },
            {
              text: "That means AI-built apps left their database open about 22 times as often as hand built apps.",
              chart: "left their database open",
              note: "about 22 times as often",
              max: 15,
              rows: [
                { who: "Lovable and Bolt", v: 13.4, show: "13%", hot: true },
                { who: "hand built", v: 0.6, show: "under 1%" },
              ],
            },
          ]}
        />
      </Section>

      <Section id="winners" title="Are winners cleaner?">
        <Scrolly
          steps={[
            {
              text: `Winning apps carry a median slop of ${r0(W.winner.median)} against ${r0(W.non_winner.median)} for everyone else.`,
              chart: "median slop, lower is better",
              max: 60,
              rows: [
                { who: "winners", v: W.winner.median, show: String(r0(W.winner.median)), hot: true },
                { who: "everyone else", v: W.non_winner.median, show: String(r0(W.non_winner.median)) },
              ],
            },
            {
              text: "No, but not dirtier either. That gap can be chalked up to chance, as winners' apps crash, leak secrets and have nonfunctioning buttons at the same rates as everyone else.",
              chart: "median slop, lower is better",
              note: "about the same",
              max: 60,
              rows: [
                { who: "winners", v: W.winner.median, show: String(r0(W.winner.median)) },
                { who: "everyone else", v: W.non_winner.median, show: String(r0(W.non_winner.median)) },
              ],
            },
            {
              text: "But speed does differ, as winning apps are heavier and hence score lower on Lighthouse.",
              chart: "median Lighthouse score, higher is better",
              max: 100,
              rows: [
                { who: "winners", v: LH.winners.median, show: String(r0(LH.winners.median)), hot: true },
                { who: "everyone else", v: LH.non_winners.median, show: String(r0(LH.non_winners.median)) },
              ],
            },
          ]}
        />
      </Section>

      <Section id="speed" title="Are faster apps cleaner?">
        <p className="story-p">
          Not exactly. When we measured performance (via Lighthouse) against the slop without the performance axis,
          the correlation was close enough to zero to call the two independent. A fast app is no more likely to be
          clean everywhere else.
        </p>
      </Section>

      <Section id="hackathons" title="Does the hackathon matter?">
        <p className="story-p">
          Across the {events.length} hackathons with {MIN_EVENT_N} or more graded apps, median slop runs from{" "}
          {r0(events[events.length - 1].median)} to {r0(events[0].median)}, a {spread.toFixed(1)}x difference.
        </p>
      </Section>

      <Section id="exploitable" title="How many are exploitable?">
        <Reveal>
          <p className="story-stat">
            <span className="story-stat-n">{r0(SEV.exploitable_pct)}%</span>
            <span className="story-stat-cap">of apps had a vulnerability an attacker could exploit right away</span>
          </p>
        </Reveal>
        <p className="story-p">
          The largest class is a credential in the bundle, most often ({GEMINI_LIVE_APPS} apps) a Google API key
          that can call the Gemini API. Next is an open Supabase or Firebase database, as {STAR.apps} apps lacked row
          level security which allowed an anonymous client to read or write rows.
        </p>
      </Section>

      <section className="story-section story-method">
        <h2 className="story-h3">How we did it</h2>
        <p className="story-p">
          Sloptic graded every app from the outside, the way any visitor sees it, against the same checks. Every
          number here is on <a href="/findings">What do real apps miss?</a>, and the method is on{" "}
          <a href="/methodology">How Sloptic finds slop</a>.
        </p>
      </section>

      <section className="story-end">
        <h2 className="story-h1">How much slop is in your app?</h2>
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
        </div>
      </section>
    </article>
  );
}
