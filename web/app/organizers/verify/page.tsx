import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import ClaimFlow from "./ClaimFlow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify your event",
  description: "Prove you run a Devpost event so Sloptic can grade its entries and publish a board.",
};

export default async function VerifyEventPage({
  searchParams,
}: {
  searchParams: { event?: string };
}) {
  const user = await currentUser();
  const prefill = searchParams.event ?? "";
  return (
    <>
      <div className="page-head">
        <h1>Verify your event</h1>
        <p className="page-lead">
          Publish a link on your event&apos;s own Devpost pages. Only its administrators can, which is
          what proves you run it.
        </p>
      </div>

      {user ? (
        <ClaimFlow initialEvent={prefill} />
      ) : (
        <section className="section attached">
          <p className="section-intro">
            Verifying ties the event to an account, so sign in first. That account is the one that can
            grade the event and publish its board.
          </p>
          <div className="cta-row">
            <a className="button" href={`/signin?next=${encodeURIComponent(`/organizers/verify?event=${prefill}`)}`}>
              Sign in / up
            </a>
          </div>
        </section>
      )}
    </>
  );
}
