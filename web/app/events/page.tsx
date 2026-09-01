import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import ClaimFlow from "./ClaimFlow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your events",
  description: "Verify a hackathon you run, and grade its entries on one scale.",
  robots: { index: false, follow: false },
};

function when(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: { event?: string };
}) {
  const user = await currentUser();
  const prefill = searchParams.event ?? "";

  if (!user) {
    return (
      <>
        <div className="page-head">
          <h1>Your events</h1>
          <p className="page-lead">
            Verify a hackathon you run and Sloptic will grade its web app entries on one scale.
          </p>
        </div>
        <section className="section attached">
          <p className="section-intro">
            Verifying ties an event to an account, so sign in first. That account is the one that can
            grade the event and publish its board, and no other account inherits it.
          </p>
          <div className="cta-row">
            <a
              className="button"
              href={`/signin?next=${encodeURIComponent(`/events?event=${prefill}`)}`}
            >
              Sign in / up
            </a>
          </div>
        </section>
      </>
    );
  }

  const { data: grants } = await supabaseAdmin()
    .from("grants")
    .select("scope, granted_at, expires_at")
    .eq("account_id", user.id)
    .eq("kind", "organizer_event")
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });

  return (
    <>
      <div className="page-head">
        <h1>Your events</h1>
        <p className="page-lead">
          Verify a hackathon you run and Sloptic will grade its web app entries on one scale.
        </p>
      </div>

      {grants && grants.length > 0 ? (
        <section className="section attached">
          <h2 className="section-head">Verified</h2>
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
                {grants.map((g) => (
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
          {/* Said plainly rather than shown as a disabled button. A greyed-out control implies the
              feature exists and you are not allowed to use it, which would be false. */}
          <p className="section-intro fineprint">
            Grading a whole field is not built yet. Verification is what it will be gated on, so
            proving the event now means it is ready when ranking lands.
          </p>
        </section>
      ) : null}

      <ClaimFlow initialEvent={prefill} />
    </>
  );
}
