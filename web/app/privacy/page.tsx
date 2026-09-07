import type { Metadata } from "next";
import { ANON_REPORT_DAYS } from "@/lib/retention";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Sloptic stores, for how long, who processes it, and how to have it deleted.",
};

const UPDATED = "1 September 2026";

export default function PrivacyPage() {
  return (
    <>
      <div className="page-head">
        <h1>Privacy</h1>
        <p className="page-lead">Last updated {UPDATED}.</p>
      </div>

      <div className="callout" data-tone="warn">
        <p className="callout-label">draft</p>
        <p>
          A working draft, not reviewed by a lawyer. Every retention window below is the one the code
          actually enforces.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">What we do not collect</h2>
        <p className="section-intro">
          Worth saying first, because it is unusual. Sloptic runs no advertising, no tracking pixels,
          and no session recorder. Your browser talks to two places besides us: our database and
          sign-in provider when you sign in, and Google or GitHub if you pick one of those to sign in
          with. Both are listed below. The one measurement we take is
          analytics on our own domain: page paths, referrers, country, and device class, counted
          cookielessly by our host with no fingerprinting, no cross-site tracking, and no IP storage.
          The URL you submit never appears in analytics. We do not sell or share personal data.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">What we store</h2>
        <div className="table-scroll">
          <table className="count-table">
            <thead>
              <tr>
                <th>what</th>
                <th>why</th>
                <th>how long</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">the URL you submit</th>
                <td>to grade it, and to show you the result</td>
                <td>kept</td>
              </tr>
              <tr>
                <th scope="row">the report</th>
                <td>the findings, measurements, and score</td>
                <td>{ANON_REPORT_DAYS} days, or kept if an account saves it</td>
              </tr>
              <tr>
                <th scope="row">a hash of your IP address</th>
                <td>rate limiting and abuse</td>
                <td>2 days</td>
              </tr>
              <tr>
                <th scope="row">page views and a few product events (a grade submitted, a grade finished)</th>
                <td>knowing what is used, and what kinds of people use Sloptic</td>
                <td>held by Vercel, aggregated, cookieless: no cookies, no IP storage, no cross-site tracking</td>
              </tr>
              <tr>
                <th scope="row">your email address</th>
                <td>only if you make an account, to sign you in</td>
                <td>until you delete the account</td>
              </tr>
              <tr>
                <th scope="row">verification records</th>
                <td>proof you control a domain or event, and when we checked</td>
                <td>until the grant expires or is revoked</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="section-intro">
          We keep the fact that a grade ran, its score and its timestamps, after the report itself is
          deleted. That is what rate limiting, abuse investigation and population statistics need, and
          none of them need the finding list.
        </p>
        <p className="section-intro">
          Sign in is by emailed link, so we never receive or store a password. If you sign in with
          Google or GitHub we receive your email address from them and nothing else.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Cookies</h2>
        <p className="section-intro">
          One kind: the session cookie that keeps you signed in. There are no advertising cookies, and
          the analytics is cookieless. Signing out clears it, and the local list below with it. Your
          browser also keeps a list of grades you ran, so you can find them again without an account.
          It lives in your browser and is cleared with your site data. When you open your grades we
          send those ids back to look them up, which is the only way to show you their scores; we
          issued them, and we do not learn anything new from it.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Who else processes it</h2>
        <ul className="stat-list">
          <li>
            <span className="k">Supabase</span>
            <span className="v">the database and the sign in service, which holds accounts and grades.</span>
          </li>
          <li>
            <span className="k">Vercel</span>
            <span className="v">
              hosting for the website, and the cookieless page analytics: paths, referrers, country,
              device class, and a few product events. No cookies, no IP storage, no cross-site tracking.
            </span>
          </li>
          <li>
            <span className="k">Resend</span>
            <span className="v">
              the service that delivers our email: your sign-in links, and the message telling you a
              grade finished. It receives your address and what the message says.
            </span>
          </li>
          <li>
            <span className="k">Zoho</span>
            <span className="v">
              the mailbox behind hello@sloptic.org, so anything you email us is held there.
            </span>
          </li>
          <li>
            <span className="k">our own hardware</span>
            <span className="v">
              the grader runs on a machine we operate, so the traffic that reaches a graded app
              comes from us.
            </span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">If your app was graded and you did not ask</h2>
        <p className="section-intro">
          Anyone can run a passive grade on a public URL, so a report may exist about an app you built
          without your involvement. It contains observations about the app. You can delete it
          yourself using its link, or write to{" "}
          <a href="mailto:hello@sloptic.org">hello@sloptic.org</a>. We will remove it, and you do not
          need an account or a reason.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Your choices</h2>
        <p className="section-intro">
          Delete any report using its link. Ask us to delete your account and everything attached to
          it. Ask what we hold about you. One address for all of it:{" "}
          <a href="mailto:hello@sloptic.org">hello@sloptic.org</a>.
        </p>
        <div className="cta-row">
          <a className="button secondary" href="/terms">
            Terms of use
          </a>
        </div>
      </section>
    </>
  );
}
