import { supabaseAdmin } from "./supabase";

/** Whether an account is suspended, and what to tell it.
 *
 *  The control that was missing. Before this the only responses to one account behaving badly were
 *  GRADING_OPEN=0, which stops everybody in order to stop one, and the per-IP rate limit, which a
 *  signed-in abuser changes for free. Anything narrower meant editing rows by hand under pressure.
 *
 *  Suspension stops the account from spending OUR outbound traffic: no grades, no event runs, no
 *  domain verification. It deliberately does not stop it signing in or reading its own reports,
 *  because the point is to stop the cost, not to hide the record from the person we cut off.
 *
 *  Read with the service role, since `profiles` is not the caller's to read for anyone but itself,
 *  and a suspended account must not be able to see or change this by any route it controls.
 */

export const SUSPENDED_FALLBACK =
  "This account is suspended. Email hello@sloptic.org if you think that is wrong.";

export type Suspension = { reason: string } | null;

export async function suspensionFor(accountId: string | null | undefined): Promise<Suspension> {
  if (!accountId) return null;
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select("suspended_at, suspended_reason")
    .eq("id", accountId)
    .maybeSingle();

  // Fails OPEN, unlike the rate limit, and the asymmetry is deliberate. The rate limit is the only
  // thing standing between an anonymous caller and the worker, so it refuses when it cannot decide.
  // This sits behind that limit and behind every other gate, so a database blip here should not
  // lock out every honest account at once. A suspension that misses one grade is recoverable; a
  // site that refuses all of them because one query failed is not.
  if (error || !data?.suspended_at) return null;
  return { reason: (data.suspended_reason as string | null)?.trim() || SUSPENDED_FALLBACK };
}
