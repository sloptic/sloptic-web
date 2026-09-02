"use client";

import { useEffect, useState } from "react";
import { rememberGrade } from "@/lib/history";
import { useRouter } from "next/navigation";
import { AREAS, AREA_BLURBS, categoriesFor } from "@/lib/checks";

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

export default function Home() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null while unknown, so the form is never wrongly shown as closed on first paint
  const [open, setOpen] = useState<boolean | null>(null);
  const [openCh, setOpenCh] = useState<string>("security");
  const [unit, setUnit] = useState<"count" | "slop">("count");
  const router = useRouter();

  useEffect(() => {
    let live = true;
    fetch("/api/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setOpen(Boolean(d.grading_open)))
      .catch(() => live && setOpen(null));
    return () => {
      live = false;
    };
  }, []);

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
      // Remember it here, not on the report page: this is the one moment we know the grade is
      // this browser's own rather than a link someone was sent.
      rememberGrade({ id: data.id, origin: data.origin ?? url.trim(), at: new Date().toISOString() });
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
          Give Sloptic a live URL. It scores how well the app holds up on the things every app should
          have, no matter what.
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
          <button type="submit" disabled={busy || open === false}>
            {busy ? "sending" : "grade it"}
          </button>
        </form>
        {open === false && (
          <p className="closed-note" role="status">
            Grading is not open yet.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="hero-alt">
          Running a hackathon? <a href="/organizers">Rank a whole event.</a>
        </p>
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
          {AREAS.map((area) => (
            <div
              key={area.id}
              className={"channel" + (openCh === area.id ? " open" : "")}
              data-axis={area.id}
            >
              <button
                className="channel-head"
                onClick={() => setOpenCh(openCh === area.id ? "" : area.id)}
                aria-expanded={openCh === area.id}
              >
                <span className="channel-dot" aria-hidden />
                <span className="channel-label">{area.label}</span>
                <span className="channel-toggle" aria-hidden>
                  {openCh === area.id ? "-" : "+"}
                </span>
              </button>
              {openCh === area.id && (
                <div className="channel-body">
                  <p className="channel-blurb">{AREA_BLURBS[area.id]}</p>
                  <ul className="probe-list">
                    {categoriesFor(area.id)
                      .slice(0, 8)
                      .map((c) => (
                        <li key={c.slug} className="probe-item">
                          <span className="probe-id" aria-hidden>
                            +
                          </span>
                          {c.href ? (
                            <a
                              href={c.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="probe-link"
                            >
                              {c.name}
                            </a>
                          ) : (
                            c.name
                          )}
                        </li>
                      ))}
                  </ul>
                  <p className="channel-more">
                    <a href={`/checks#${area.id}`}>See all {area.categories} in this area.</a>
                  </p>
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
              Like golf. A 0 means nothing was found. There is no maximum. A messier app just scores
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
              across ten pages counts once.
            </p>
          </div>
          <div className="row2">
            <span className="term">Compared to real apps</span>
            <p className="desc">
              Your score is ranked against a large set of real apps, so the number comes with where you
              stand among them.
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
              <code>/.well-known/sloptic-verification.txt</code> and in a DNS record. Not open yet.{" "}
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
            throwaway output that generative AI now produces in bulk, and <b>optic</b>, an instrument
            for bringing something into focus. The apparatus by which slop of the software kind, the
            app that ships functional but unhardened, is resolved into a single comparable number,
            serenely indifferent to whatever it was meant to be.
          </p>
        </div>
      </section>
    </>
  );
}
