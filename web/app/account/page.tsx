import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import AccountActions from "./AccountActions";

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

      {/* There is nothing to edit here on purpose. Sign in is an emailed link, so the address is the
          identity rather than a preference, and we ask for nothing else: no name, no avatar, no
          settings. A profile form would be a form over an empty table. */}
      <section className="section attached">
        <h2 className="section-head">What we hold</h2>
        <ul className="stat-list">
          <li>
            <span className="k">email</span>
            <span className="v">
              {user.email}. It is how you sign in, and the only personal detail we ask for.
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
                ? `Accepted ${when(profile.terms_accepted_at)}.`
                : "Not recorded yet. Sign out and back in to accept the current terms, which the active tier needs."}
            </span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-head">What this account may grade</h2>
        {grants && grants.length > 0 ? (
          <div className="table-scroll">
            <table className="count-table">
              <thead>
                <tr>
                  <th>what</th>
                  <th>proven</th>
                  <th>until</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={`${g.kind}:${g.scope}`}>
                    <th scope="row">
                      {g.kind === "organizer_event" ? `${g.scope} (event)` : g.scope}
                    </th>
                    <td>{when(g.granted_at)}</td>
                    <td>{when(g.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="section-intro">
            Nothing yet. Anyone can run the passive floor on any URL, so an account is only needed for
            the checks that send real traffic. <a href="/events">Verify an event</a> or{" "}
            <a href="/verify">verify a domain you own</a>.
          </p>
        )}
        <p className="section-intro fineprint">
          A grant says this account may grade that thing, never that the thing is open to everyone. It
          is re-checked before each run and expires on the date shown.
        </p>
      </section>

      <AccountActions email={user.email ?? ""} grantCount={grants?.length ?? 0} />
    </>
  );
}
