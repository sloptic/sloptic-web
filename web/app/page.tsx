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

      <section className="measures">
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
            whether its CORS rules, dependencies, and mixed content leave an opening. Across 1,528 real
            apps we graded, <b>98% shipped no Content-Security-Policy at all</b>.
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
            build rather than a dev bundle left in place. <b>70% of the apps we graded had a critical
            accessibility violation.</b>
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

        <p className="measures-foot">
          These 37 probes run on any URL, because they only observe what is already public. The other 54
          send real attack traffic, injection, fuzzing, multiple accounts, so they run only once you
          verify you own the domain.
        </p>
      </section>
    </>
  );
}
