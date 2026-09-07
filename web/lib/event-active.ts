import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * May this account send attack traffic at the field of this event?
 *
 * One function because two routes ask it: starting a run and flipping a resolved one to active. They
 * had the same check written out twice already, and a gate that exists in two copies is a gate that
 * eventually exists in one. The mode switch is the copy an attacker would reach for, since a passive
 * run is self-serve and would otherwise be one POST away from an active one.
 *
 * THREE things must hold, and none of them substitutes for another:
 *
 *   1. A live organizer grant for this account and this event. Checked by the callers, since they
 *      need the grant anyway to decide admin.
 *   2. The disclosure existed before entrants submitted (`window_open_at_verification`). This is
 *      what stands in for the participants' consent, and it is why a claim verified after the
 *      deadline can never go active.
 *   3. A human approved the event.
 *
 * Three exists because one and two are both asserted by the same party, so the whole chain is
 * forgeable by one actor with a Devpost account: publish our link in the rules of an event you
 * invented, submit entries from throwaway accounts pointing at somebody else's site, verify before
 * your own deadline. Every check passes and Sloptic attacks strangers on your behalf, from our IP.
 * Approval is the only link in the chain that the forger cannot also supply.
 */

export const ACTIVE_AFTER_DEADLINE =
  "This event was not verified before its submission deadline, so entries get the passive checks only.";

export const ACTIVE_NOT_APPROVED =
  "Active grading of an event field is approved by hand right now. Email hello@sloptic.org with " +
  "your event and we will look. Passive grading is running already and needs nothing from us.";

export const ACTIVE_UNREADABLE =
  "Could not confirm this event's approval. Try again shortly.";

/**
 * The reason this account may NOT run this event actively, or null if it may.
 *
 * Fails CLOSED, unlike the queue and budget checks at the public door. Those refuse a grade when
 * they cannot read, and letting one through on a database blip costs a queued job. Here the thing
 * behind the gate is injection payloads aimed at third parties, so an unreadable answer has to mean
 * no. The asymmetry is the point: fail open where the cost is inconvenience, fail closed where the
 * cost is somebody else's server.
 */
export async function activeEventRefusal(
  db: SupabaseClient,
  accountId: string,
  slug: string,
): Promise<string | null> {
  const { data: claim, error } = await db
    .from("event_claims")
    .select("window_open_at_verification, active_approved")
    .eq("account_id", accountId)
    .eq("slug", slug)
    .eq("status", "verified")
    .maybeSingle();

  if (error) {
    console.error("active event approval unreadable:", error.message);
    return ACTIVE_UNREADABLE;
  }
  // A missing claim is not an approval either: no row means nothing was ever verified under this
  // account, and `undefined !== true` has to read as a refusal rather than as an absence of one.
  if (claim?.window_open_at_verification !== true) return ACTIVE_AFTER_DEADLINE;
  if (claim?.active_approved !== true) return ACTIVE_NOT_APPROVED;
  return null;
}
