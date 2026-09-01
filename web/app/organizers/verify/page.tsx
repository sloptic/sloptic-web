import { redirect } from "next/navigation";

// The claim flow moved to /events, which is where the verified list lives too. Kept as a redirect
// because the address was linked from the organizers page and may be in someone's history.
export default function VerifyEventRedirect({
  searchParams,
}: {
  searchParams: { event?: string };
}) {
  const q = searchParams.event ? `?event=${encodeURIComponent(searchParams.event)}` : "";
  redirect(`/events${q}`);
}
