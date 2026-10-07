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
    "What do apps miss?",
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

/** A screen of its own. The page snaps from one to the next, so each scroll turns a page. */
function Page({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`page ${className}`.trim()} id={id}>
      {children}
    </section>
  );
}

/** The question alone on its page; the answer is the next page. */
function Question({ id, n, children }: { id: string; n: number; children: string }) {
  return (
    <Page id={id} className="page-q">
      <Reveal>
        <p className="story-kicker">question {n}</p>
        <h2 className="story-q">{children}</h2>
      </Reveal>
    </Page>
  );
}

export default function FindingsDemoPage() {
  const D = F.distribution;
  const A = F.attrition;
  const W = F.winners;
  const SEV = F.severity;
  const LH = F.lighthouse;
  const events = comparableEvents(MIN_EVENT_N, "active");
  const spread = events[0].median / events[events.length - 1].median;
  const graded = `${(Math.floor(A.graded / 100) * 100).toLocaleString("en-US")}+`;
  const csp = r0(fireRate("sec-headers-002") ?? 0);
  const a11y = r0(fireRate("qa-a11y-001") ?? 0);
  const common = [...F.fire_frequency]
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6)
    .map((r) => {
      const f = PROBE_FACTS.find((x) => x.id === r.probe_id);
      return { label: f ? probeName(f).replace(/`/g, "") : r.probe_id, pct: r.pct, hot: r.bundle === "accessibility" || r.bundle === "performance" };
    });

  return (
    <article className={`story story-snap ${serif.variable}`}>
      <Page className="page-cover">
        <header className="story-head">
          <p className="story-kicker">Sloptic findings</p>
          <h1 className="story-h1">Sloptic graded {graded} apps and none were clean</h1>
          <p className="story-dek">
            What Sloptic found when it graded apps from {F.provenance.n_events} hackathons
          </p>
          <p className="story-byline">By Ian Sun · October 7, 2026</p>
        </header>
      </Page>

      <Page>
        <Reveal>
          <aside className="story-key">
            <p className="story-key-head">Key findings</p>
            <ul>
              <li>No apps scored 0.</li>
              <li>{csp}% have no content security policy and {a11y}% have accessibility issues.</li>
              <li>Almost 30% of app links were already dead, and nearly half past 18 months.</li>
              <li>Hackathon winners are no cleaner than everyone else, and their apps are heavier.</li>
            </ul>
          </aside>
        </Reveal>
      </Page>

      <Question id="clean" n={1}>Is any app clean?</Question>
      <Page>
        <Reveal>
          <h2 className="story-h2">Nothing is clean</h2>
          <p className="story-p story-lede">
            The median scored {r0(D.median)}, and a quarter scored above {r0(D.q3)}. No app scored 0, and the cleanest
            scored {r0(D.min)}. In other words, there is slop in every app.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <figure className="story-fig">
            <figcaption className="story-figcap">Slop scores across {graded} apps. Lower is better.</figcaption>
            <Histogram />
          </figure>
        </Reveal>
      </Page>

      <Question id="miss" n={2}>What do teams miss?</Question>
      <Page>
        <Reveal>
          <h2 className="story-h2">The slop that nobody sees are...</h2>
          <p className="story-p">
            missing security headers, accessibility issues, and slow performance.
            Most are invisible to the builders.
          </p>
        </Reveal>
        <Reveal delay={200}>
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
      </Page>

      {/* Link rot: CORPUS_REPORT.md 2.2 (sloptic-main). Of the 2,685 links handed to the grader, 800 were
          dead before it could grade them, and the dead share grows with time since the event. /findings
          counts the dead links under "What didn't get graded". */}
      <Question id="survive" n={3}>Do hackathon apps survive?</Question>
      <Scrolly
        steps={[
          {
            text: "Not for long. Under three months after a hackathon, 15% of app links were already dead.",
            chart: "app links that were dead, by time since the hackathon",
            max: 50,
            rows: [
              { who: "under 3 months", v: 15, show: "15%", hot: true },
              { who: "3 to 12 months", v: 0, show: "" },
              { who: "over 18 months", v: 0, show: "" },
            ],
          },
          {
            text: "From three to twelve months, the share held near 29%.",
            chart: "app links that were dead, by time since the hackathon",
            max: 50,
            rows: [
              { who: "under 3 months", v: 15, show: "15%" },
              { who: "3 to 12 months", v: 29, show: "29%", hot: true },
              { who: "over 18 months", v: 0, show: "" },
            ],
          },
          {
            text: "Past eighteen months, it reached 48%. Nearly half of the apps were gone.",
            chart: "app links that were dead, by time since the hackathon",
            note: "almost 30% of all links were dead",
            max: 50,
            rows: [
              { who: "under 3 months", v: 15, show: "15%" },
              { who: "3 to 12 months", v: 29, show: "29%" },
              { who: "over 18 months", v: 48, show: "48%", hot: true },
            ],
          },
        ]}
      />

      <Question id="winners" n={4}>Are hackathon winners cleaner?</Question>
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
            text: "No, but not dirtier either. Winners' apps crash, leak secrets and have nonfunctioning buttons at the same rates as everyone else.",
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

      <Question id="speed" n={5}>Are faster apps cleaner?</Question>
      <Page>
        <Reveal>
          <h2 className="story-h2">Not exactly</h2>
          <p className="story-p">
            Speed and the rest of the slop are independent. A fast app is no more likely to be clean everywhere
            else.
          </p>
        </Reveal>
      </Page>

      <Question id="hackathons" n={6}>Does the hackathon matter?</Question>
      <Page>
        <Reveal>
          <p className="story-stat">
            <span className="story-stat-n">{spread.toFixed(1)}x</span>
            <span className="story-stat-cap">between the cleanest and sloppiest hackathon&apos;s median slop</span>
          </p>
          <p className="story-p">
            Across the {events.length} hackathons with {MIN_EVENT_N} or more graded apps, median slop runs from{" "}
            {r0(events[events.length - 1].median)} to {r0(events[0].median)}.
          </p>
        </Reveal>
      </Page>

      <Question id="exploitable" n={7}>How many are exploitable?</Question>
      <Page>
        <Reveal>
          <p className="story-stat">
            <span className="story-stat-n">{r0(SEV.exploitable_pct)}%</span>
            <span className="story-stat-cap">of apps had a vulnerability an attacker could exploit right away</span>
          </p>
          <p className="story-p">
            The largest class is a credential in the bundle, most often ({GEMINI_LIVE_APPS} apps) a Google API key
            that can call the Gemini API.
          </p>
        </Reveal>
      </Page>

      <Page className="page-end">
        <Reveal>
          <h2 className="story-q">How much slop is in your app?</h2>
          <div className="cta-row">
            <a className="button" href="/">
              Grade an app
            </a>
          </div>
        </Reveal>
      </Page>
    </article>
  );
}
