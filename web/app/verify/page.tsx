import type { Metadata } from "next";
import { TOTALS } from "@/lib/checks";

export const metadata: Metadata = {
  title: "Verifying your site",
  description:
    `Why Sloptic runs ${TOTALS.passive} of its ${TOTALS.total} checks by default, and what proving you own a site unlocks.`,
};

export default function VerifyPage() {
  return (
    <>
      <div className="page-head">
        <h1>Why only some checks run</h1>
        <p className="page-lead">
          Sloptic has {TOTALS.total} checks. On a URL nobody has proven they own, it runs the{" "}
          {TOTALS.passive} that only read what a visitor can already see. Here is why, and what changes
          when you prove the site is yours.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">The two kinds of checks</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">
              Look-only
              <span className="sub">{TOTALS.passive} checks</span>
            </span>
            <p className="desc">
              These read what your app already shows every visitor: its settings, the page it serves,
              how fast it loads, whether a screen reader can use it. Running them on a stranger&apos;s
              site is no different from visiting it, so they run on any URL. They are also where most of
              the score comes from.
            </p>
          </div>
          <div className="row2">
            <span className="term">
              Hands-on
              <span className="sub">{TOTALS.active} checks</span>
            </span>
            <p className="desc">
              These go looking for holes by sending real attack traffic: injection payloads, malformed
              input, file uploads, repeated logins. That is useful on your own app and
              not okay on someone else&apos;s, so they stay locked until we know who
              is asking and that they own the target.
            </p>
          </div>
        </div>
        <p className="section-intro" style={{ marginTop: "1.75rem" }}>
          This is not a paywall. Pointing attack traffic at a site you do not own is unauthorized
          testing, whatever your intent.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What proving ownership takes</h2>
        <p className="section-intro">
          Two things, because they answer two different questions, who is asking and whether they
          control the site.
        </p>
        <div className="rows">
          <div className="row2">
            <span className="term">An account</span>
            <p className="desc">
              Permission is attached to a person, not to a URL. It means a request to run the hands-on
              checks is always traceable to someone who agreed to the terms.
            </p>
          </div>
          <div className="row2">
            <span className="term">A token you serve</span>
            <p className="desc">
              We give you a random string. You publish it at a fixed path on the site:
              <br />
              <code>https://your-site.com/.well-known/sloptic-verification.txt</code>
              <br />
              We fetch that path and check it matches. Putting a file at a chosen path on a site is
              something only whoever controls the deployment can do, which is exactly the thing being
              proven.
            </p>
          </div>
          <div className="row2">
            <span className="term">On a custom domain, a DNS record too</span>
            <p className="desc">
              A TXT record at <code>_sloptic.your-domain.com</code> holding the same token. The file
              proves you control what the site serves, the DNS record proves you control the domain
              itself. They are separate things, so someone who manages to plant a file still cannot
              pass.
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
