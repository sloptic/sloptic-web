import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import AccountActions from "./AccountActions";
import GradeList from "../grades/GradeList";
import VerifyFlow from "../verify/VerifyFlow";
import { claimsForAccount } from "@/lib/domain-claims";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

function when(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?next=/account");

  const db = supabaseAdmin();
  const [{ data: profile }, { data: grants }, claims] = await Promise.all([
    db.from("profiles").select("terms_accepted_at, created_at").eq("id", user.id).maybeSingle(),
    db
      .from("grants")
      .select("kind, scope, granted_at, expires_at")
      .eq("account_id", user.id)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false }),
    claimsForAccount(user.id),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>Your account</h1>
        <p className="page-lead">{user.email}</p>
      </div>

      {/* The apps and events sections render the SAME components /grades and /events do, rather
          than a second implementation of each list. Two views of one dataset written twice is how
          they end up disagreeing, which already happened once with the percentile direction. */}
      <section className="section attached">
        <h2 className="section-head" id="your-grades">Apps you graded</h2>
        <p className="section-intro">
          Grades saved to this account and any unsaved grades from this browser.
        </p>
        <GradeList signedIn />
      </section>

      <section className="section">
        <h2 className="section-head">Events you grade for</h2>
        <p className="section-intro">
          Verified events, their runs, and their boards live on its own pages.
        </p>
        <div className="cta-row">
          <a className="button secondary" href="/events">Your events</a>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">Your domains</h2>
        <p className="section-intro">
          Verifying a domain lets you run active tests against it (for this account only). Unverified
          domains get passive checks only. {" "}
          <a href="/verify">More about verifying here.</a>.
        </p>
        <VerifyFlow signedIn initialClaims={claims} />
      </section>

      <section className="section">
        <h2 className="section-head">Sign in info</h2>
        <ul className="stat-list">
          <li>
            <span className="k">email</span>
            <span className="v">
              {user.email}
            </span>
          </li>
          <li>
            <span className="k">joined</span>
            <span className="v">{when(profile?.created_at ?? user.created_at)}</span>
          </li>
          <li>
            <span className="k">terms</span>
            <span className="v">
              {profile?.terms_accepted_at
                ? `Accepted ${when(profile.terms_accepted_at)}`
                : "Not recorded yet. Sign out and back in to accept the current terms."}
            </span>
          </li>
        </ul>
      </section>

      <AccountActions email={user.email ?? ""} />
    </>
  );
}
