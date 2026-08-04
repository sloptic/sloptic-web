"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHANNELS } from "@/lib/checks";

// Sample grade, passive mode. Each axis splits three ways: what failed, what applied, what the mode
// could have run. Read in checks or in slop points, since a handful of failed checks can cost more than
// a pile of them. The point totals sum to the 42 above.
const SAMPLE_AXES = [
  {
    id: "security",
    label: "security",
    failed: 4,
    applied: 9,
    possible: 14,
    slopFailed: 20,
    slopApplied: 46,
    slopPossible: 62,
  },
  {
    id: "qa",
    label: "quality",
    failed: 3,
    applied: 8,
    possible: 12,
    slopFailed: 14,
    slopApplied: 38,
    slopPossible: 55,
  },
  {
    id: "performance",
    label: "performance",
    failed: 2,
    applied: 6,
    possible: 11,
    slopFailed: 8,
    slopApplied: 26,
    slopPossible: 40,
  },
];

const SAMPLE_FINDINGS = [
  {
    axis: "security",
    name: "no content security policy",
    desc: "Nothing tells the browser which scripts may run, so an injected one would.",
    penalty: 5,
  },
  {
    axis: "qa",
    name: "development build shipped",
    desc: "The live site serves a dev build, which exposes internals and runs slower.",
    penalty: 8,
  },
  {
    axis: "performance",
    name: "slow first response",
    desc: "The server took over a second to send the first byte.",
    penalty: 3,
  },
];

const SAMPLE_PASSED = [
  {
    axis: "security",
    name: "clickjacking defense",
    desc: "The app refuses to be framed by another site.",
  },
  {
    axis: "qa",
    name: "images have alt text",
    desc: "A screen reader can describe every image on the page.",
  },
];

// One check. Links out to the authority that defines it when there is a canonical one.
function ProbeItem({ name, href }: { name: string; href?: string }) {
  return (
    <li className="probe-item">
      <span className="probe-id" aria-hidden>
        +
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="probe-link">
          {name}
        </a>
      ) : (
        name
      )}
    </li>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCh, setOpenCh] = useState<string>("security");
  const [unit, setUnit] = useState<"count" | "slop">("count");
  const [mode, setMode] = useState<"grade" | "rank">("grade");
  const [eventUrl, setEventUrl] = useState("");
  const [rankNote, setRankNote] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      router.push(`/grade/${data.id}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  // Ranking an event is organizer-initiated on purpose: starting one is the consent signal for
  // grading other people's submissions. The landing collects the event, then hands off to the
  // organizer page, which explains what verifying involves.
  function submitRank(e: React.FormEvent) {
    e.preventDefault();
    const host = eventUrl.trim().replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    if (!host.endsWith(".devpost.com")) {
      setRankNote("That does not look like a Devpost event. It should look like your-event.devpost.com.");
      return;
    }
    router.push(`/organizers?event=${encodeURIComponent(eventUrl.trim())}`);
  }

  return (
    <>
      <section className="hero">
        <div className="mode-switch" role="group" aria-label="What to grade">
          <button
            type="button"
            aria-pressed={mode === "grade"}
            onClick={() => setMode("grade")}
          >
            grade an app
          </button>
          <button type="button" aria-pressed={mode === "rank"} onClick={() => setMode("rank")}>
            rank an event
          </button>
        </div>

        {mode === "grade" ? (
          <>
            <h1 className="lede">Grade a deployed web app.</h1>
            <p className="deck">
              Give Sloptic a live URL. It scores how well the app holds up on the things every app
              should have, no matter what.
            </p>

            <form onSubmit={submit} className="grade-form">
              <input
                type="text"
                inputMode="url"
                placeholder="https://your-app.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label="Deployed web app URL"
                autoFocus
              />
              <button type="submit" disabled={busy}>
                {busy ? "sending" : "grade it"}
              </button>
            </form>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="lede">Rank a whole hackathon.</h1>
            <p className="deck">
              Give Sloptic a Devpost event. It grades every submission the same way and puts them on
              one scale, so the entries can actually be compared.
            </p>

            <form onSubmit={submitRank} className="grade-form">
              <input
                type="text"
                inputMode="url"
                placeholder="https://your-event.devpost.com"
                value={eventUrl}
                onChange={(e) => setEventUrl(e.target.value)}
                aria-label="Devpost event URL"
              />
              <button type="submit">rank it</button>
            </form>
            {rankNote && (
              <p className="rank-note" role="status">
                {rankNote}
              </p>
            )}
          </>
        )}
      </section>

      <section className="what" id="what">
        <div className="what-body">
          <h2 className="section-head">What is Sloptic?</h2>
          <p className="what-text">
            Sloptic is a{" "}
            <a
              href="https://en.wikipedia.org/wiki/Black-box_testing"
              target="_blank"
              rel="noopener noreferrer"
            >
              black box
            </a>{" "}
            web app grader. It checks the security, accessibility, quality, and 
            performance traits that every app should get right, whatever it was 
            built to do. Because those traits do not depend on an app's purpose, 
            Sloptic can compare and rank apps against each other.
          </p>
        </div>

        <ol className="flowchart">
          <li className="flow-box">
            <span className="n">01</span>
            <p>Paste a URL. No setup needed.</p>
          </li>
          <li className="flow-conn" aria-hidden />
          <li className="flow-box">
            <span className="n">02</span>
            <p>Sloptic opens it in a real browser and checks what any visitor sees.</p>
          </li>
          <li className="flow-conn" aria-hidden />
          <li className="flow-box">
            <span className="n">03</span>
            <p>
              You get one score with a breakdown on every issue found and what was tested.
            </p>
          </li>
        </ol>
      </section>

      <section className="channels" id="checks">
        <div className="channels-head">
          <h2>What it checks</h2>
          <a className="channels-stat" href="/checks">
            every check
          </a>
        </div>
        <p className="channels-intro">
          Sloptic checks the things every web app should get right, no matter what it does. Open an
          area to see what gets checked.
        </p>
        <p className="channels-note">
          Note that in anonymous mode, we only run the <em>passive</em> checks, i.e. checks that do not
          alter the site, send attack payloads, or go fishing for secrets. To run the <em>active</em>{" "}
          ones, log in and <a href="/verify">prove the site is yours</a>.
        </p>
        <div className="channel-list">
          {CHANNELS.map((ch) => (
            <div
              key={ch.id}
              className={"channel" + (openCh === ch.id ? " open" : "")}
              data-axis={ch.id}
            >
              <button
                className="channel-head"
                onClick={() => setOpenCh(openCh === ch.id ? "" : ch.id)}
                aria-expanded={openCh === ch.id}
              >
                <span className="channel-dot" aria-hidden />
                <span className="channel-label">{ch.label}</span>
                <span className="channel-toggle" aria-hidden>
                  {openCh === ch.id ? "-" : "+"}
                </span>
              </button>
              {openCh === ch.id && (
                <div className="channel-body">
                  <p className="channel-blurb">{ch.blurb}</p>
                  <p className="probe-group-label">Runs on any URL</p>
                  <ul className="probe-list">
                    {ch.open.map((p) => (
                      <ProbeItem key={p.name} name={p.name} href={p.href} />
                    ))}
                  </ul>
                  <p className="probe-group-label">Needs you to verify the site is yours</p>
                  <ul className="probe-list gated">
                    {ch.gated.map((p) => (
                      <ProbeItem key={p.name} name={p.name} href={p.href} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="sample" id="sample">
        <div className="sample-head">
          <h2>What you get back</h2>
          <span className="sample-tag">sample</span>
        </div>
        <div className="sample-card">
          <div className="sample-meta">
            <span className="sample-url">https://example-hackathon-app.vercel.app</span>
            <span className="sample-mode">passive mode</span>
          </div>
          <div className="sample-score">
            <span className="sample-num">42</span>
            <span className="sample-unit">lower is better</span>
          </div>

          <div className="unit-toggle" role="group" aria-label="Show counts or slop points">
            <button
              type="button"
              aria-pressed={unit === "count"}
              onClick={() => setUnit("count")}
            >
              checks
            </button>
            <button type="button" aria-pressed={unit === "slop"} onClick={() => setUnit("slop")}>
              slop points
            </button>
          </div>

          <div className="sample-axes">
            {SAMPLE_AXES.map((a) => {
              const failed = unit === "count" ? a.failed : a.slopFailed;
              const applied = unit === "count" ? a.applied : a.slopApplied;
              const possible = unit === "count" ? a.possible : a.slopPossible;
              return (
                <div key={a.id} className="sample-axis" data-axis={a.id}>
                  <span className="sample-axis-name">{a.label}</span>
                  <span className="sample-axis-track">
                    <span className="seg failed" style={{ flexGrow: failed }} />
                    <span className="seg clean" style={{ flexGrow: applied - failed }} />
                    <span className="seg na" style={{ flexGrow: possible - applied }} />
                  </span>
                  <span className="sample-axis-val">
                    {failed}
                    <span className="of">/{applied}</span>
                    <span className="of dim">/{possible}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="sample-legend">
            <span className="key failed" aria-hidden /> failed
            <span className="key clean" aria-hidden /> passed
            <span className="key na" aria-hidden /> did not apply
            <span className="legend-note">
              {unit === "count"
                ? "Checks that failed, out of those that applied, out of every check in this mode."
                : "Slop scored, out of what those checks could have cost, out of the whole mode."}
            </span>
          </p>

          <div className="sample-findings">
            {SAMPLE_FINDINGS.map((f) => (
              <div className="finding-row" data-axis={f.axis} key={f.name}>
                <span className="finding-dot" />
                <span className="finding-body">
                  <span className="finding-cat">{f.name}</span>
                  <span className="finding-desc">{f.desc}</span>
                </span>
                <span className="finding-pen">+{f.penalty}</span>
              </div>
            ))}
            {SAMPLE_PASSED.map((f) => (
              <div className="finding-row passed" data-axis={f.axis} key={f.name}>
                <span className="finding-dot" />
                <span className="finding-body">
                  <span className="finding-cat">{f.name}</span>
                  <span className="finding-desc">{f.desc}</span>
                </span>
                <span className="finding-pen">0</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="score">
        <h2 className="section-head">The score</h2>
        <p className="section-intro">
          One number, so you can see how your app is doing at a glance and compare it to others.
        </p>
        <div className="rows">
          <div className="row2">
            <span className="term">Lower is better</span>
            <p className="desc">
              Like golf. A 0 means nothing was found. There is no maximum: a messier app just scores
              higher.
            </p>
          </div>
          <div className="row2">
            <span className="term">It only counts problems</span>
            <p className="desc">
              You do not earn points for what you did right; the score only adds up what is wrong. An
              app with nothing to fix and an app that fixed everything both score 0.
            </p>
          </div>
          <div className="row2">
            <span className="term">Weighted by how much it matters</span>
            <p className="desc">
              A serious security hole adds more than a small nicety, and the same problem repeated
              across ten pages counts once, not ten times.
            </p>
          </div>
          <div className="row2">
            <span className="term">Compared to real apps</span>
            <p className="desc">
              Your score is ranked against a large set of real apps, so you see not just a number but
              where you stand.
            </p>
          </div>
        </div>
      </section>

      <section className="section tiers" id="tiers">
        <h2 className="section-head">Passive by default</h2>
        <p className="section-intro">
          Some checks would send real attack traffic at a site. Pointing those at a site you have not
          shown you own would be wrong, so by default Sloptic never does.
        </p>
        <ol className="tier-grid">
          <li className="tier" data-step="1">
            <h3>Anyone</h3>
            <p className="tier-req">no account</p>
            <p className="tier-desc">
              The look-only checks run on any URL. They read what your app already shows the public, so
              they are safe to point at anything, and they are most of what the score is made of.
            </p>
          </li>
          <li className="tier" data-step="2">
            <h3>Your own site</h3>
            <p className="tier-req">verify the domain</p>
            <p className="tier-desc">
              Sign in, then publish a token we give you at{" "}
              <code>/.well-known/sloptic-verification.txt</code>. Once we can fetch it back, the rest of
              the checks run and the result gets ranked.{" "}
              <a href="/verify">What verifying involves.</a>
            </p>
          </li>
          <li className="tier" data-step="3">
            <h3>Running an event</h3>
            <p className="tier-req">verify the event</p>
            <p className="tier-desc">
              Grade the web app entries in your hackathon on one scale, so they can be compared.{" "}
              <a href="/organizers">How it works for organizers.</a>
            </p>
          </li>
        </ol>
        <div className="cta-row">
          <a className="button secondary" href="/verify">
            Why only some run
          </a>
          <a className="button secondary" href="/methodology">
            How the grade works
          </a>
        </div>
      </section>

      <section className="section" id="name">
        <div className="definition">
          <p className="definition-word">
            sloptic <span className="definition-pron">/ˈslɒp.tɪk/</span>{" "}
            <span className="definition-pos">noun</span>
          </p>
          <p className="definition-body">
            A coinage from <b>slop</b>, Merriam-Webster&apos;s word of the year for 2025 for the
            low-effort output that generative AI now produces in bulk, and <b>optic</b>, an instrument
            for bringing something into focus. The apparatus by which slop of the software kind, the
            app that ships functional but unhardened, is resolved into a single comparable number,
            serenely indifferent to whatever it was meant to be.
          </p>
        </div>
      </section>
    </>
  );
}
