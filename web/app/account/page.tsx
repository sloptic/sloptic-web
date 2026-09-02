import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import AccountActions from "./AccountActions";
import GradeList from "../grades/GradeList";
import ClaimFlow from "../events/ClaimFlow";

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
  const [{ data: profile }, { data: grants }] = await Promise.all([
    db.from("profiles").select("terms_accepted_at, created_at").eq("id", user.id).maybeSingle(),
    db
      .from("grants")
      .select("kind, scope, granted_at, expires_at")
      .eq("account_id", user.id)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false }),
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
        <h2 className="section-head">Apps you graded</h2>
        <p className="section-intro">
          Grades saved to this account and any this browser ran but hasn't been saved yet.
        </p>
        <GradeList signedIn />
      </section>

      <section className="section">
        <h2 className="section-head">Events you grade for</h2>
        {grants && grants.filter((g) => g.kind === "organizer_event").length > 0 ? (
          <div className="table-scroll">
            <table className="count-table">
              <thead>
                <tr>
                  <th>event</th>
                  <th>verified</th>
                  <th>re-prove by</th>
                </tr>
              </thead>
              <tbody>
                {grants
                  .filter((g) => g.kind === "organizer_event")
                  .map((g) => (
                    <tr key={g.scope}>
                      <th scope="row">
                        <a href={`https://${g.scope}.devpost.com`} rel="noopener noreferrer">
                          {g.scope}.devpost.com
                        </a>
                      </th>
                      <td>{when(g.granted_at)}</td>
                      <td>{when(g.expires_at)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <ClaimFlow />
        <p className="section-intro fineprint">
          Grading a whole field is not ready yet.
        </p>
      </section>

      <section className="section">
        <h2 className="section-head">Domains you own</h2>
        {grants && grants.filter((g) => g.kind === "app_origin").length > 0 ? (
          <ul className="stat-list">
            {grants
              .filter((g) => g.kind === "app_origin")
              .map((g) => (
                <li key={g.scope}>
                  <span className="k">{g.scope}</span>
                  <span className="v">Active grading until {when(g.expires_at)}.</span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="section-intro">
            None yet. <a href="/verify">What verifying involves</a>.
          </p>
        )}
      </section>

      <section className="section">
        <h2 className="section-head">Sign in</h2>
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

      <AccountActions email={user.email ?? ""} grantCount={grants?.length ?? 0} />
    </>
  );
}
