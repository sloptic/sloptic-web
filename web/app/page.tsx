"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Real catalog groupings. `open` runs on any URL (look-only); `gated` needs domain verification
// because those checks send test traffic. Counts match the grader: 37 of 91 are look-only.
const CHANNELS = [
  {
    id: "security",
    label: "security",
    passive: 14,
    total: 57,
    blurb:
      "The settings a browser expects, no secrets left in the code you ship, and no sharing rules that let other sites read your data.",
    open: [
      "security headers",
      "secrets in the shipped code",
      "exposed data",
      "sharing rules (CORS)",
      "mixed content",
      "known-vulnerable dependencies",
    ],
    gated: [
      "sql injection",
      "cross-site scripting",
      "login rate limiting",
      "access control",
      "session handling",
      "file uploads",
      "path traversal",
      "open redirects",
    ],
  },
  {
    id: "qa",
    label: "accessibility & quality",
    passive: 12,
    total: 22,
    blurb:
      "Buttons and forms a screen reader can use, links that go somewhere, pages that load instead of quietly failing, and a finished build rather than a development version left online.",
    open: [
      "accessibility",
      "broken links",
      "pages that fail quietly",
      "console errors",
      "content types",
      "development build left online",
      "honest navigation",
    ],
    gated: ["crash resistance", "bad input handling", "data integrity", "dead controls"],
  },
  {
    id: "performance",
    label: "performance",
    passive: 11,
    total: 12,
    blurb:
      "Real load-speed measurements, how much it has to download, and whether it is compressed and cached. This is where apps built in a hurry slip most.",
    open: [
      "core web vitals",
      "load time",
      "time to first byte",
      "page weight",
      "request count",
      "compression",
      "caching",
    ],
    gated: ["behavior under load"],
  },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCh, setOpenCh] = useState<string>("security");
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

  return (
    <>
      <section className="hero">
        <h1 className="lede">Grade a deployed web app.</h1>
        <p className="deck">
          Give Sloptic a live URL. It returns one number for how well the app holds up along with the
          security, accessibility, and performance issues it found. No specs needed. It only grades the
          things every app should have.
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
      </section>

      <section className="channels" id="checks">
        <div className="channels-head">
          <h2>What it checks</h2>
          <span className="channels-stat">37 of 91 run on any URL</span>
        </div>
        <p className="channels-intro">
          The things every web app should get right, whatever it does. Open an area to see what is
          covered, and which parts need you to verify the site is yours.
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
                <span className="channel-count">
                  {ch.passive} of {ch.total} run on any URL
                </span>
                <span className="channel-meter" aria-hidden>
                  <span
                    className="channel-meter-fill"
                    style={{ width: `${(ch.passive / ch.total) * 100}%` }}
                  />
                </span>
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
                      <li key={p} className="probe-item">
                        <span className="probe-id" aria-hidden>
                          +
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                  <p className="probe-group-label">Needs you to verify the site is yours</p>
                  <ul className="probe-list gated">
                    {ch.gated.map((p) => (
                      <li key={p} className="probe-item">
                        <span className="probe-id" aria-hidden>
                          +
                        </span>
                        {p}
                      </li>
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
            <span className="sample-mode">37 checks</span>
          </div>
          <div className="sample-score">
            <span className="sample-num">42</span>
            <span className="sample-unit">lower is better</span>
          </div>
          <div className="sample-axes">
            {[
              { id: "security", val: 20, pct: 48 },
              { id: "quality", val: 14, pct: 33 },
              { id: "performance", val: 8, pct: 19 },
            ].map((a, i) => (
              <div
                key={a.id}
                className="sample-axis"
                data-axis={["security", "qa", "performance"][i]}
              >
                <span className="sample-axis-name">{a.id}</span>
                <span className="sample-axis-track">
                  <span className="sample-axis-fill" style={{ width: `${a.pct}%` }} />
                </span>
                <span className="sample-axis-val">{a.val}</span>
              </div>
            ))}
          </div>
          <div className="sample-coverage">
            <span className="coverage-label">tested</span>
            <span className="coverage-bar">
              <span className="coverage-fill" style={{ width: "62%" }} />
            </span>
            <span className="coverage-val">23 of 37 applied</span>
          </div>
          <div className="sample-findings">
            <div className="finding-row" data-axis="security">
              <span className="finding-dot" />
              <span className="finding-cat">no content security policy</span>
              <span className="finding-pen">+5</span>
            </div>
            <div className="finding-row" data-axis="qa">
              <span className="finding-dot" />
              <span className="finding-cat">development build shipped</span>
              <span className="finding-pen">+8</span>
            </div>
            <div className="finding-row" data-axis="performance">
              <span className="finding-dot" />
              <span className="finding-cat">slow first response</span>
              <span className="finding-pen">+3</span>
            </div>
          </div>
        </div>
      </section>

      <section className="flow" id="how">
        <h2>How it works</h2>
        <div className="flow-steps">
          <div className="flow-step">
            <span className="flow-num">01</span>
            <span className="flow-text">Paste a URL. No account, no code, no setup.</span>
          </div>
          <span className="flow-arrow" aria-hidden>
            &rarr;
          </span>
          <div className="flow-step">
            <span className="flow-num">02</span>
            <span className="flow-text">
              Sloptic opens it in a real browser and checks what any visitor sees.
            </span>
          </div>
          <span className="flow-arrow" aria-hidden>
            &rarr;
          </span>
          <div className="flow-step">
            <span className="flow-num">03</span>
            <span className="flow-text">
              You get one score, the breakdown, every issue with evidence, and what was tested.
            </span>
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
        <div className="rows">
          <div className="row2">
            <span className="term">Anyone</span>
            <p className="desc">
              37 look-only checks run on any URL. They read only what your app already shows the public,
              so they are safe to run on anything. This is most of what matters.
            </p>
          </div>
          <div className="row2">
            <span className="term">If it is your site</span>
            <p className="desc">
              Prove you own the domain and Sloptic runs the full set, including the checks that actively
              probe for holes, and ranks the result.
            </p>
          </div>
          <div className="row2">
            <span className="term">Running an event</span>
            <p className="desc">
              Grade and rank every hackathon submission on the same scale.{" "}
              <a href="/organizers">See how it works for organizers.</a>
            </p>
          </div>
        </div>
        <div className="cta-row">
          <a className="button secondary" href="/methodology">
            How the grade works
          </a>
        </div>
      </section>
    </>
  );
}
