import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import EventActions from "./EventActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Event", robots: { index: false, follow: false } };

export default async function EventPage({ params }: { params: { slug: string } }) {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=/events/${params.slug}`);

  const { data: grant } = await supabaseAdmin()
    .from("grants")
    .select("granted_at, expires_at")
    .eq("account_id", user.id)
    .eq("kind", "organizer_event")
    .eq("scope", params.slug)
    .is("revoked_at", null)
    .maybeSingle();

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      <div className="page-head">
        <p className="back-link"><a href="/events">Back to events</a></p>
        <h1>{params.slug}</h1>
        <p className="page-lead">
          <a href={`https://${params.slug}.devpost.com`} rel="noopener noreferrer">
            {params.slug}.devpost.com
          </a>
          {grant ? ` · verified, re-prove by ${when(grant.expires_at)}` : ""}
        </p>
      </div>

      <EventActions slug={params.slug} verified={!!grant} />
    </>
  );
}
