"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Real catalog groupings. `open` runs on any URL (look-only); `gated` needs domain verification
// because those checks send test traffic. Counts match the grader: 37 of 91 are look-only.
//
// Each item may carry a link to the authority that defines it (MDN for the web platform, OWASP for
// security, W3C for accessibility, web.dev for Core Web Vitals). Every URL here was checked. Items with
// no single canonical source stay unlinked on purpose: a weak citation is worse than none.
// A check, optionally linked to the authority that defines it.
type Check = { name: string; href?: string };
type Channel = {
  id: string;
  label: string;
  passive: number;
  total: number;
  blurb: string;
  open: Check[];
  gated: Check[];
};

const CHANNELS: Channel[] = [
  {
    id: "security",
    label: "security",
    passive: 14,
    total: 57,
    blurb:
      "Getting this wrong costs the people who trusted your app, not you. Sloptic looks for missing defenses and secrets left in the code you ship, following OWASP.",
    open: [
      { name: "security headers", href: "https://owasp.org/www-project-secure-headers/" },
      {
        name: "secrets in the shipped code",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
      },
      { name: "exposed data", href: "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/" },
      {
        name: "sharing rules (CORS)",
        href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS",
      },
      {
        name: "mixed content",
        href: "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content",
      },
      {
        name: "known-vulnerable dependencies",
        href: "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/",
      },
    ],
    gated: [
      {
        name: "sql injection",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
      },
      { name: "cross-site scripting", href: "https://owasp.org/www-community/attacks/xss/" },
      {
        name: "login rate limiting",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html",
      },
      { name: "access control", href: "https://owasp.org/Top10/A01_2021-Broken_Access_Control/" },
      {
        name: "session handling",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html",
      },
      {
        name: "file uploads",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html",
      },
      { name: "path traversal", href: "https://owasp.org/www-community/attacks/Path_Traversal" },
      {
        name: "open redirects",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html",
      },
    ],
  },
  {
    id: "qa",
    label: "accessibility & quality",
    passive: 12,
    total: 22,
    blurb:
      "An app a screen reader cannot operate is closed to the people who rely on one. Sloptic checks whether controls work and whether pages fail honestly, using axe-core against WCAG.",
    open: [
      { name: "accessibility", href: "https://www.w3.org/WAI/standards-guidelines/wcag/" },
      { name: "broken links" },
      {
        name: "pages that fail quietly",
        href: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors",
      },
      { name: "console errors" },
      {
        name: "content types",
        href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types",
      },
      { name: "development build left online" },
      { name: "honest navigation" },
    ],
    gated: [
      { name: "crash resistance" },
      {
        name: "bad input handling",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html",
      },
      { name: "data integrity" },
      { name: "dead controls" },
    ],
  },
  {
    id: "performance",
    label: "performance",
    passive: 11,
    total: 12,
    blurb:
      "Most people will not wait for a slow app, so Sloptic measures real load speed and page weight as Google's Core Web Vitals.",
    open: [
      { name: "core web vitals", href: "https://web.dev/articles/vitals" },
      { name: "load time", href: "https://web.dev/articles/optimize-lcp" },
      { name: "time to first byte", href: "https://web.dev/articles/ttfb" },
      {
        name: "page weight",
        href: "https://developer.chrome.com/docs/lighthouse/performance/total-byte-weight",
      },
      { name: "request count" },
      {
        name: "compression",
        href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression",
      },
      { name: "caching", href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching" },
    ],
    gated: [{ name: "behavior under load" }],
  },
];

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
          Give Sloptic a live URL. It scores how well the app holds up on the things
          every app should have, no matter what.
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
          <a className="channels-stat" href="/verify">
            37 of 91 run on any URL
          </a>
        </div>
        <p className="channels-intro">
          Sloptic checks the things every web app should get right, no matter what it does. Open an area
          to see what gets checked.
        </p>
        <p className="channels-note">
          Note that in anonymous mode, we only run a set of 37 <em>passive</em> checks, i.e. checks that
          do not alter the site, send attack payloads, or go fishing for secrets. To run the other 54{" "}
          <em>active</em> checks, log in and <a href="/verify">prove the site is yours</a>.
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
        <div className="rows">
          <div className="row2">
            <span className="term">Anyone</span>
            <p className="desc">
              37 look-only checks on any URL, no account needed. They read what your app already shows
              the public, so they are safe to point at anything. This is most of what the score is made
              of.
            </p>
          </div>
          <div className="row2">
            <span className="term">Your own site</span>
            <p className="desc">
              Sign in, then publish a token we give you at{" "}
              <code>/.well-known/sloptic-verification.txt</code> on the site. Once we can fetch it back,
              the other 54 checks run and the result gets ranked.{" "}
              <a href="/verify">What verifying involves.</a>
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
          <a className="button secondary" href="/verify">
            Why only 37 checks
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
