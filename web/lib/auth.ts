// Session access for server code. Supabase Auth owns the account; we own the grants.
//
// Two clients, deliberately kept apart:
//   * this one is the USER's session, anon-key + their cookies, so RLS applies and it can only ever
//     see what that account may see;
//   * lib/supabase.ts is the SERVICE ROLE, which bypasses RLS and must never be handed a user's
//     input as authority. A grant is written there, never here: an account must not be able to
//     create the authorization that would empower it.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Public config: the anon key is meant to reach the browser, unlike the service role key. */
export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  return { url, key };
}

/** A Supabase client carrying the caller's session, for use in server components and route handlers. */
export function supabaseSession(): SupabaseClient {
  const { url, key } = publicSupabaseConfig();
  const store = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // A server component cannot set cookies; middleware refreshes the session instead, so
        // swallowing here is correct rather than a silent failure.
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* read-only context */
        }
      },
    },
  });
}

/** The signed-in user, or null. Uses getUser(), which verifies the token with the auth server;
 *  getSession() only decodes whatever cookie was sent and must not be trusted for authorization. */
export async function currentUser(): Promise<User | null> {
  const { data } = await supabaseSession().auth.getUser();
  return data.user ?? null;
}
