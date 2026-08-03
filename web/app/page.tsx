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
          The things every web app should get right, whatever it does. Sloptic looks only at what a
          normal visitor can already see, no code and no login, and reports what it finds in three
          areas.
        </p>

        <div className="measure" data-axis="security">
          <h3>
            <span className="measure-swatch" aria-hidden />
            security
            <span className="cnt">14 checks</span>
          </h3>
          <p>
            The basics that keep your visitors safe: the security settings a browser expects, no
            passwords or API keys accidentally left in the code you ship, and no sharing rules that let
            other sites read your data.
          </p>
        </div>

        <div className="measure" data-axis="qa">
          <h3>
            <span className="measure-swatch" aria-hidden />
            accessibility &amp; quality
            <span className="cnt">12 checks</span>
          </h3>
          <p>
            Whether the app actually works for everyone: buttons and forms a screen reader can use,
            links that go somewhere, pages that load instead of quietly failing, and a finished build
            rather than a development version left online.
          </p>
        </div>

        <div className="measure" data-axis="performance">
          <h3>
            <span className="measure-swatch" aria-hidden />
            performance
            <span className="cnt">11 checks</span>
          </h3>
          <p>
            How fast and light the app is to load: real load-speed measurements, how much it has to
            download, and whether it is compressed and cached. This is where apps built in a hurry slip
            most: they work, but they are heavy and slow.
          </p>
        </div>
      </section>

      <section className="section" id="how">
        <h2 className="section-head">How it works</h2>
        <p className="section-intro">
          Nothing to install and nothing to set up. Sloptic looks at your app from the outside, the way
          a first-time visitor would.
        </p>
        <div className="steps">
          <div className="step">
            <span className="num">01</span>
            <h3>Paste your URL</h3>
            <p>Give it the address of your live app. No account, no code, no configuration.</p>
          </div>
          <div className="step">
            <span className="num">02</span>
            <h3>It looks at your app</h3>
            <p>
              It opens your app in a real browser and checks what any visitor sees: how it is set up,
              whether it loads well, and whether it works for everyone.
            </p>
          </div>
          <div className="step">
            <span className="num">03</span>
            <h3>You get a report</h3>
            <p>
              One score, a breakdown by area, every issue it found with the evidence, and a note on how
              much of the app it was able to test.
            </p>
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
              A serious security hole adds more than a small nicety, and the same problem repeated across
              ten pages counts once, not ten times.
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

      <section className="section" id="tiers">
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
