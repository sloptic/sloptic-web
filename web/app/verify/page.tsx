import type { Metadata } from "next";
import { TOTALS } from "@/lib/checks";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import VerifyFlow, { type Claim } from "./VerifyFlow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verifying your site",
  description:
    `Why Sloptic runs ${TOTALS.passive} of its ${TOTALS.total} checks by default.`,
};

export default async function VerifyPage() {
  const user = await currentUser();
  let claims: Claim[] = [];
  if (user) {
    const db = supabaseAdmin();
    const [{ data: rows }, { data: grants }] = await Promise.all([
      db
        .from("domain_claims")
        .select("id, origin, host, token, status, file_status, dns_status, detail, checked_at, verified_at")
        .eq("account_id", user.id)
        .order("issued_at", { ascending: false })
        .limit(50),
      db
        .from("grants")
        .select("scope, expires_at")
        .eq("account_id", user.id)
        .eq("kind", "app_origin")
        .is("revoked_at", null),
    ]);
    const expiry = new Map((grants ?? []).map((g) => [g.scope as string, g.expires_at as string]));
    claims = (rows ?? []).map((c) => ({ ...c, expires_at: expiry.get(c.origin) ?? null })) as Claim[];
  }

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
        <h2 className="section-head">Verify a site</h2>
        <VerifyFlow signedIn={!!user} initialClaims={claims} />
      </section>

      <section className="section">
        <h2 className="section-head">How to verify</h2>
        <p className="section-intro">
          Three things are needed:
        </p>
        <div className="card-grid">
          <div className="card">
            <h3>An account</h3>
            <p>Permission attaches to a person.</p>
          </div>
          <div className="card">
            <h3>A file you serve</h3>
            <p>
              Publish the token we give you at{" "}
              <code>/.well-known/sloptic-verification.txt</code>. Only whoever controls the website
              can put it there. <b>Note that it MUST be at this exact path!</b>
            </p>
          </div>
          <div className="card">
            <h3>A DNS record</h3>
            <p>
              The same token in a TXT record at <code>_sloptic.your-domain.com</code>. If you do not have a custom
              domain, you can attach one or enter a verified event.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">What verification implies</h2>
        <div className="rows">
          <div className="row2">
            <span className="term">It is yours</span>
            <p className="desc">
              Verifying does not make a site globally available for active grading, only that YOU can grade it.
              The rest still only get passive checks.
            </p>
          </div>
          <div className="row2">
            <span className="term">It covers that site only</span>
            <p className="desc">
              Permission applies to the exact site you verified.
            </p>
          </div>
          <div className="row2">
            <span className="term">It expires and is rechecked</span>
            <p className="desc">
              Permission lapses after a few months, after which you need to re-verify.
            </p>
          </div>
        </div>
        <div className="cta-row">
          <a className="button" href="/">
            Run the free checks
          </a>
          <a className="button secondary" href="/events">
            Verify an event
          </a>
        </div>
      </section>
    </>
  );
}
