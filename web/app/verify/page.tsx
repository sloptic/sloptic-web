import type { Metadata } from "next";
import { TOTALS } from "@/lib/checks";

export const metadata: Metadata = {
  title: "Verifying your site",
  description:
    `Why Sloptic runs ${TOTALS.passive} of its ${TOTALS.total} checks by default.`,
};

export default function VerifyPage() {
  return (
    <>
      <div className="page-head">
        <h1>Why only some checks run</h1>
        <p className="page-lead">
          Sloptic has {TOTALS.total} tests. On a URL nobody has proven they own, it runs the{" "}
          {TOTALS.passive} checks that only read what a visitor can see. Why?
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">The two kinds of tests</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">
              Passive
              <span className="sub">{TOTALS.passive} checks</span>
            </span>
            <p className="desc">
              These read what your app already shows to everyone. Running them on a stranger&apos;s
              site is no different from visiting it, so they run on any URL. 
            </p>
          </div>
          <div className="row2">
            <span className="term">
              Active
              <span className="sub">{TOTALS.active} checks</span>
            </span>
            <p className="desc">
              These poke the app in a myriad of ways, including submitting forms, sending large requests, uploading files
              and attempting injection attacks. Doing this would be unauthorized testing on a site you do not own, which 
              is why we have to verify you control the site before running them. 
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">How to verify</h2>
        <p className="section-intro">
          Two things are needed:
        </p>
        <div className="card-grid">
          <div className="card">
            <h3>An account</h3>
            <p>Permission attaches to a person, not to a site.</p>
          </div>
          <div className="card">
            <h3>A file you serve</h3>
            <p>
              Publish the token we give you at{" "}
              <code>/.well-known/sloptic-verification.txt</code>. Only whoever controls the deployment
              can.
            </p>
          </div>
          <div className="card">
            <h3>A DNS record</h3>
            <p>
              The same token in a TXT record at <code>_sloptic.your-domain.com</code>. Serving a file
              and editing a zone are different powers, so planting one is not enough.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">The rules it follows</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">It is yours, not the site&apos;s</span>
            <p className="desc">
              Verifying does not mark a site as open season. It records that your account may run the
              hands-on checks on that site. Someone else pasting the same URL still gets the look-only set.
            </p>
          </div>
          <div className="row2">
            <span className="term">It covers that site only</span>
            <p className="desc">
              Permission applies to the exact site you verified, and a redirect cannot carry it
              somewhere else.
            </p>
          </div>
          <div className="row2">
            <span className="term">It expires, and is rechecked</span>
            <p className="desc">
              The token has to still be in place when a grade runs, and permission lapses after a few
              months. A domain that changes hands does not inherit the old owner&apos;s permission.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">If your app is on a platform subdomain</h2>
        <p className="section-intro">
          On an address like <code>your-app.vercel.app</code>, the DNS record is not something you can
          add, since the domain belongs to the platform. There are two ways forward. Attach a custom
          domain, which you control fully, or enter an event, where the organizer vouches for the
          entries and the file token is enough on its own.
        </p>
        <p className="section-intro">
          There is one more case. If your app serves the same page for every path, as many apps built
          around a single page do, the token file can be swallowed by that fallback. A{" "}
          <code>&lt;meta name=&quot;sloptic-site-verification&quot;&gt;</code> tag in the page head then
          does the same job.
        </p>
        <div className="cta-row">
          <a className="button" href="/">
            Run the free checks
          </a>
          <a className="button secondary" href="/organizers">
            For event organizers
          </a>
        </div>
      </section>
    </>
  );
}
