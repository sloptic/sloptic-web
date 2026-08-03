"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

      <section className="measures" id="checks">
        <h2 className="measures-head">What it checks</h2>
        <p className="measures-intro">
          Sloptic grades the intent-independent floor: the parts of an app that are wrong no matter what
          it was built to do. It reads only what any visitor already sees, no source and no login, and
          reports what it finds across three axes.
        </p>

        <div className="measure" data-axis="security">
          <h3>
            <span className="measure-swatch" aria-hidden />
            security
            <span className="cnt">14 passive probes</span>
          </h3>
          <p>
            Whether the app sets the headers and policies that stop a browser being turned against its
            own users, whether a secret or source file is sitting in the code it ships to everyone, and
            whether its CORS rules, dependencies, and mixed content leave an opening.
          </p>
        </div>

        <div className="measure" data-axis="qa">
          <h3>
            <span className="measure-swatch" aria-hidden />
            accessibility &amp; qa
            <span className="cnt">12 passive probes</span>
          </h3>
          <p>
            Whether the interface actually holds up: controls a screen reader can operate, links that
            resolve, pages that return honest status codes instead of soft 404s, and a real production
            build rather than a dev bundle left in place.
          </p>
        </div>

        <div className="measure" data-axis="performance">
          <h3>
            <span className="measure-swatch" aria-hidden />
            performance
            <span className="cnt">11 passive probes</span>
          </h3>
          <p>
            How heavy and how slow the app is to load, measured with real Core Web Vitals, page weight,
            request count, compression, and caching. This is where AI-built apps fall hardest: they ship
            functional but heavy, trading load speed for build speed.
          </p>
        </div>
      </section>

      <section className="section" id="how">
        <h2 className="section-head">How it works</h2>
        <p className="section-intro">
          No setup, no agent, no access. Sloptic works the way a careful stranger would, from the
          outside.
        </p>
        <div className="steps">
          <div className="step">
            <span className="num">01</span>
            <h3>Point it at a URL</h3>
            <p>Paste a live URL. Sloptic needs nothing else from you: no repository, no build, no keys.</p>
          </div>
          <div className="step">
            <span className="num">02</span>
            <h3>It probes what a visitor sees</h3>
            <p>
              It maps the app&apos;s surface, then runs its battery over HTTP and in a real browser:
              headers and TLS, accessibility and Core Web Vitals, broken pages and dev builds.
            </p>
          </div>
          <div className="step">
            <span className="num">03</span>
            <h3>You get a comparable grade</h3>
            <p>
              One slop score, the three-axis breakdown, every finding with its evidence, and a coverage
              report so a low score reads as clean rather than untested.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="score">
        <h2 className="section-head">The score</h2>
        <p className="section-intro">
          The number is the product. It is built to mean the same thing across wildly different apps,
          which is what a scanner&apos;s list of bugs can never do.
        </p>
        <div className="rows">
          <div className="row2">
            <span className="term">Deduction-only</span>
            <p className="desc">
              There is no positive credit. An app starts at zero and only accrues slop. Zero means
              nothing was found, whether the app had no weak surface or defended all of it.
            </p>
          </div>
          <div className="row2">
            <span className="term">Lower is better, unbounded</span>
            <p className="desc">
              No 0-to-100 ceiling to curve toward. A worse app simply scores higher, with no cap.
            </p>
          </div>
          <div className="row2">
            <span className="term">Risk-priced and damped</span>
            <p className="desc">
              Each penalty is expected harm, frequency times severity, and one root cause counts once.
              Ten pages missing a header are one finding, not ten.
            </p>
          </div>
          <div className="row2">
            <span className="term">Comparable</span>
            <p className="desc">
              A frozen reference population turns a raw score into a rank, so a grade is not just a
              number but a place among real apps.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="tiers">
        <h2 className="section-head">Passive by default</h2>
        <p className="section-intro">
          Sloptic can fire real attack payloads: injection, fuzzing, uploads. Aiming those at a URL you
          have not proven you own would be unauthorized testing, so it never does.
        </p>
        <div className="rows">
          <div className="row2">
            <span className="term">Anyone</span>
            <p className="desc">
              37 passive probes on any URL. They read only what the app already serves, so they are safe
              on a target you do not own. This is most of the signal.
            </p>
          </div>
          <div className="row2">
            <span className="term">Domain owners</span>
            <p className="desc">
              Verify you control the origin and Sloptic runs the full 91, including the active probes,
              and ranks the result against the population.
            </p>
          </div>
          <div className="row2">
            <span className="term">Event organizers</span>
            <p className="desc">
              Register a hackathon and grade every submission on one yardstick.{" "}
              <a href="/organizers">See how it works for organizers.</a>
            </p>
          </div>
        </div>
        <div className="cta-row">
          <a className="button secondary" href="/methodology">
            Read the methodology
          </a>
        </div>
      </section>
    </>
  );
}
