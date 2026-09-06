"use client";

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";
import { rememberGrade } from "@/lib/history";
import { useRouter } from "next/navigation";
import { AREAS, AREA_BLURBS, categoriesFor } from "@/lib/checks";
import { provisionalCleanerThan } from "@/lib/corpus";
import ScoreBand, { type AxisRow } from "./ScoreBand";

// Sample grade, passive mode, in the shape the real report hands its band.
//
// Each axis splits three ways: what failed, what applied, what the mode could have run. `slop` is
// what the axis carried and `potential` the most it could have carried had every applicable check
// fired, which is the ceiling the points view scales against. The point totals sum to SAMPLE_SCORE
// and the possible counts to the passive battery's real 44 (security 17, qa 15, performance 12), so
// the sample does not quietly disagree with the numbers the rest of the site quotes.
const SAMPLE_SCORE = 42;

const SAMPLE_ROWS: AxisRow[] = [
  { id: "security", label: "security", failed: 4, applied: 9, possible: 17, slop: 20, potential: 46 },
  { id: "qa", label: "quality", failed: 3, applied: 8, possible: 15, slop: 14, potential: 38 },
  { id: "performance", label: "performance", failed: 2, applied: 6, possible: 12, slop: 8, potential: 26 },
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
  // Deleting an account lands here with ?deleted=1 and, until now, nothing said so.
  const [deleted, setDeleted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("deleted") !== "1") return;
    setDeleted(true);
    // Out of the URL once it is read, so a refresh or a shared link does not repeat the news.
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

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
      track("grade_submitted");
      router.push(`/grade/${data.id}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hero">
        <h1 className="lede">How much slop is in your app?</h1>
        <p className="deck">
          Paste a URL. Sloptic looks at it the way a visitor would and scores what it finds. Lower is better.
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
        {deleted && (
          <p className="closed-note" role="status">
            Your account is deleted. Reports you saved are anonymous now and go in 30 days.
          </p>
        )}
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
            Sloptic is a web app grader. It checks how much slop your web app has, like a leaked
            secret, a crash, a page taking forever to load, and more. As these are unacceptable to
            any app, Sloptic can grade any app you point it at no matter what it does.
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
              You get a score with a breakdown on every issue found and what was tested.
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
          Open an area to see what kinds of slop Sloptic checks for.
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
        <br />
        <p className="channels-note">
          Note that in anonymous mode, we only run the <em>passive</em> checks, i.e. checks that do not
          alter the site or send attacks. To run the <em>active</em>{" "}
          ones, log in and <a href="/verify">prove the site is yours</a>.
        </p>
      </section>

      <section className="sample" id="sample">
        <div className="sample-head">
          <h2>What you get back</h2>
          <span className="sample-tag">sample</span>
        </div>
        {/* The sample IS the report's band, not a picture of one. It drifted last time because it
            was a copy: it still said "lower is better" where the report says "slop score", kept a
            did-not-apply key in points mode where the report drops it, and used a toggle styled
            differently. A promise about what you get back is worth nothing if the real thing looks
            different when it arrives. Layout mirrors the report too: the target line, the band,
            then findings below, rather than everything inside one box. */}
        <div className="sample-meta">
          <span className="sample-url">https://example-hackathon-app.vercel.app</span>
          <span className="sample-mode">passive mode</span>
        </div>

        <ScoreBand
          score={SAMPLE_SCORE}
          /* From the shipped passive curve, so the sample's placement is a real reading of a real
             population rather than a number someone liked the look of. */
          cleanerThanPct={provisionalCleanerThan(SAMPLE_SCORE, "passive")}
          mode="passive"
          rows={SAMPLE_ROWS}
        />

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
