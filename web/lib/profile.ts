import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";

/** Mirror a freshly signed-in account into `profiles`, with the service role.
 *
 *  Shared by both sign-in landings (`/auth/callback` for OAuth's code exchange, `/auth/confirm` for
 *  an emailed token hash) rather than written twice. The duplication mattered: `terms_accepted_at`
 *  is what `verify_domain_claim` checks before writing a grant, so a sign-in path that forgot to
 *  stamp it would leave those accounts permanently unable to verify a domain, and the failure would
 *  surface days later in the worker as "the account has not accepted the terms".
 *
 *  A user must never write their own row here, which is why this takes the service role and not the
 *  caller's session.
 */
export async function mirrorProfile(user: User): Promise<void> {
  try {
    const db = supabaseAdmin();
    await db.from("profiles").upsert({ id: user.id, email: user.email }, { onConflict: "id" });
    // Stamped only where it is still null. An upsert carrying the date would rewrite it on every
    // sign-in, so the column would always read "today" and stop being evidence of when this account
    // accepted anything, which is the one job it has.
    await db
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("terms_accepted_at", null);
  } catch {
    // A profile row is bookkeeping; failing it must not strand a signed-in user with no way back.
  }
}
