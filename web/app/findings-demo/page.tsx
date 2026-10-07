import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { ACTIVE, GEMINI_LIVE_APPS, fireRate, comparableEvents, MIN_EVENT_N, fmt } from "@/lib/corpus";
import { Count, Reveal } from "./Showcase";

// /findings as a showcase, for presenting live: each question gets the screen to itself, and scrolling
// reveals the answer. Same corpus and same wording as /findings, full grades only (the p values and
// transcribed figures exist for full grades alone), with the numbers rounded for a room rather than a
// reader. Kept out of search and out of the menus: /findings is the page of record.
export const metadata: Metadata = {
  ...pageMeta(
    "What do real apps miss?",
    `What Sloptic found when it graded ${ACTIVE.attrition.graded.toLocaleString("en-US")} apps in ${ACTIVE.provenance.n_events} hackathons.`,
    "/findings-demo",
  ),
  robots: { index: false, follow: false },
};

const F = ACTIVE;
const r0 = (n: number) => Math.round(n);

/** Slop across the corpus, bars growing from the axis as it reveals. */
function Histogram() {
  const D = F.distribution;
  const bins = D.bins as [number, number, number][];
  const peak = Math.max(...bins.map((b) => b[2]));
  const W = 720;
  const H = 220;
  const bw = W / bins.length;
  const x = (v: number) => (v / (bins[bins.length - 1][1] || 1)) * W;
  return (
    <svg className="sc-hist" viewBox={`0 0 ${W} ${H + 30}`} role="img"
         aria-label={`Histogram of slop scores across ${D.n} apps, median ${fmt(D.median)}.`}>
      {bins.map(([lo, , n], i) => {
        const h = (n / peak) * H;
        return (
          <rect key={lo} x={x(lo) + 1} y={H - h} width={bw - 2} height={h} rx="3"
                style={{ ["--bd" as string]: `${i * 25}ms` }} />
        );
      })}
      <line x1="0" y1={H} x2={W} y2={H} className="sc-axis" />
      <line x1={x(D.median)} y1="0" x2={x(D.median)} y2={H} className="sc-median" />
      <text x={x(D.median) + 8} y="16" className="sc-label">median {r0(D.median)}</text>
      <text x={W} y={H + 24} textAnchor="end" className="sc-label">slop score</text>
    </svg>
  );
}

/** Two values, two bars, the first one ours to point at. */
function Versus({ rows, max }: { rows: { who: string; v: number; hot?: boolean }[]; max: number }) {
  return (
    <div className="vs">
      {rows.map((r, i) => (
        <div className="vs-row" data-hot={r.hot ? "" : undefined} key={r.who}>
          <span className="vs-who">{r.who}</span>
          <span className="vs-track">
            <span className="vs-fill" style={{ width: `${(r.v / max) * 100}%`, ["--bd" as string]: `${200 + i * 250}ms` }} />
          </span>
          <span className="vs-num">{r0(r.v)}</span>
        </div>
      ))}
    </div>
  );
}

function Question({ kicker, children }: { kicker: string; children: string }) {
  return (
    <section className="scene q">
      <Reveal>
        <p className="sc-kicker">{kicker}</p>
        <h2 className="sc-question">{children}</h2>
      </Reveal>
    </section>
  );
}

export default function FindingsDemoPage() {
  const D = F.distribution;
  const A = F.attrition;
  const W = F.winners;
  const SEV = F.severity;
  const LH = F.lighthouse;
  type BuilderRow = { builder: string; n: number; median: number };
  const builder = (name: string) =>
    ((F as { by_builder?: BuilderRow[] }).by_builder ?? []).find((b) => b.builder === name) ?? { builder: name, n: 0, median: 0 };
  const events = comparableEvents(MIN_EVENT_N, "active");
  const spread = events[0].median / events[events.length - 1].median;
  const graded = Math.floor(A.graded / 100) * 100;

  return (
    <div className="showcase">
      <section className="scene sc-hero">
        <p className="sc-kicker">what Sloptic found</p>
        <h1 className="sc-question">What do real apps miss?</h1>
        <p className="sc-body">
          Sloptic graded <b>{graded.toLocaleString("en-US")}+</b> real apps from {F.provenance.n_events} hackathons. Here&apos;s
          what it found.
        </p>
        <p className="sc-scroll" aria-hidden>
          scroll ↓
        </p>
      </section>

      <Question kicker="question">Is any app clean?</Question>
      <section className="scene">
        <Reveal>
          <p className="sc-kicker">nothing is clean</p>
          <span className="sc-fig accent"><Count to={0} /></span>
          <span className="sc-cap">apps scored a clean 0</span>
        </Reveal>
        <Reveal delay={150}>
          <p className="sc-body">
            The median is {r0(D.median)}, and a quarter scored above {r0(D.q3)}. The cleanest scored {r0(D.min)}. In
            other words, there is slop in every app.
          </p>
        </Reveal>
        <Reveal delay={300}>
          <Histogram />
        </Reveal>
      </section>

      <Question kicker="question">What do teams miss?</Question>
      <section className="scene">
        <div className="sc-stats">
          <Reveal>
            <span className="sc-fig"><Count to={r0(fireRate("sec-headers-002") ?? 0)} suffix="%" /></span>
            <span className="sc-cap">of apps have no content security policy</span>
          </Reveal>
          <Reveal delay={200}>
            <span className="sc-fig"><Count to={r0(fireRate("qa-a11y-001") ?? 0)} suffix="%" /></span>
            <span className="sc-cap">of apps have an accessibility barrier, most often low contrast text</span>
          </Reveal>
          <Reveal delay={400}>
            <span className="sc-fig"><Count to={r0(fireRate("perf-lighthouse-001") ?? 0)} suffix="%" /></span>
            <span className="sc-cap">of apps score below 90 on Lighthouse</span>
          </Reveal>
        </div>
        <Reveal delay={600}>
          <p className="sc-body">
            The most common kinds of slop are missing security headers, accessibility issues, and slow performance.
            Most are invisible to the teams building the apps.
          </p>
        </Reveal>
      </section>

      <Question kicker="question">Are AI-built apps sloppier?</Question>
      <section className="scene">
        <Reveal>
          <p className="sc-answer">Not overall.</p>
          <p className="sc-cap">median slop, lower is better</p>
        </Reveal>
        <Reveal delay={150}>
          <Versus
            max={Math.max(builder("lovable").median, builder("hand built").median)}
            rows={[
              { who: "Lovable", v: builder("lovable").median, hot: true },
              { who: "hand built", v: builder("hand built").median },
            ]}
          />
        </Reveal>
      </section>
      <section className="scene">
        <Reveal>
          <p className="sc-answer">But their databases are.</p>
          <span className="sc-fig accent"><Count to={22} suffix="×" /></span>
          <span className="sc-cap">as often, AI-built apps left their database open</span>
        </Reveal>
        <Reveal delay={200}>
          <p className="sc-body">
            Backends make up the difference, as Lovable and Bolt both offer Supabase as a built in database and AIs
            rarely configure it properly. 13% of Lovable and Bolt apps left theirs open, against under 1% of hand
            built apps.
          </p>
        </Reveal>
      </section>

      <Question kicker="question">Are hackathon winners cleaner?</Question>
      <section className="scene">
        <Reveal>
          <p className="sc-answer">No, but not dirtier either.</p>
          <p className="sc-cap">median slop, lower is better</p>
        </Reveal>
        <Reveal delay={150}>
          <Versus
            max={Math.max(W.winner.median, W.non_winner.median)}
            rows={[
              { who: "winners", v: W.winner.median, hot: true },
              { who: "everyone else", v: W.non_winner.median },
            ]}
          />
          <p className="sc-body">
            The gap can be chalked up to chance. Winners&apos; apps crash, leak secrets and have nonfunctioning buttons at
            the same rates as everyone else.
          </p>
        </Reveal>
      </section>
      <section className="scene">
        <Reveal>
          <p className="sc-answer">But they&apos;re heavier.</p>
          <p className="sc-cap">median Lighthouse score, higher is better</p>
        </Reveal>
        <Reveal delay={150}>
          <Versus
            max={100}
            rows={[
              { who: "winners", v: LH.winners.median, hot: true },
              { who: "everyone else", v: LH.non_winners.median },
            ]}
          />
          <p className="sc-body">Winning apps are heavier and hence score lower on Lighthouse.</p>
        </Reveal>
      </section>

      <Question kicker="question">Are faster apps cleaner?</Question>
      <section className="scene">
        <Reveal>
          <p className="sc-answer">Not exactly.</p>
          <span className="sc-fig accent">≈ 0</span>
          <span className="sc-cap">correlation between Lighthouse performance and the rest of the slop</span>
        </Reveal>
        <Reveal delay={200}>
          <p className="sc-body">Speed and the rest of the slop are close enough to call independent.</p>
        </Reveal>
      </section>

      <Question kicker="question">Does the hackathon matter?</Question>
      <section className="scene">
        <Reveal>
          <span className="sc-fig accent"><Count to={Number(spread.toFixed(1))} decimals={1} suffix="×" /></span>
          <span className="sc-cap">between the cleanest and sloppiest hackathon&apos;s median slop</span>
        </Reveal>
        <Reveal delay={200}>
          <p className="sc-body">
            Across the {events.length} hackathons with {MIN_EVENT_N} or more graded apps, median slop runs from{" "}
            {r0(events[events.length - 1].median)} to {r0(events[0].median)}.
          </p>
        </Reveal>
      </section>

      <Question kicker="question">How many are exploitable?</Question>
      <section className="scene">
        <Reveal>
          <p className="sc-answer">Only a few.</p>
          <span className="sc-fig accent"><Count to={r0(SEV.exploitable_pct)} suffix="%" /></span>
          <span className="sc-cap">of apps had a vulnerability an attacker could exploit right away</span>
        </Reveal>
        <Reveal delay={200}>
          <p className="sc-body">
            The largest class is a credential in the bundle, most often ({GEMINI_LIVE_APPS} apps) a Google API key that
            can call the Gemini API.
          </p>
        </Reveal>
      </section>

      <section className="scene sc-end">
        <Reveal>
          <h2 className="sc-question">How much slop is in your app?</h2>
          <div className="cta-row">
            <a className="button" href="/">
              Grade an app
            </a>
            <a className="button secondary" href="/findings">
              Every finding
            </a>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
