import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase client using the service-role key. RLS is on with no public policies, so this
// key is the ONLY way to read/write. It must never reach the client bundle, so this module is imported
// only from route handlers (server code). Do not import it from a Client Component.

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only)");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false },
    // Next patches global fetch with its own cache, and supabase-js goes through it, so query
    // results get memoized and every poll replays an old snapshot. That is how a job showed as
    // `queued` on the site while the database said `running`, and how a 7-second-old heartbeat read
    // as no worker at all: the route ran fresh, the DATA it got back did not. Route-level
    // `dynamic = "force-dynamic"` does not cover fetches made by a library, so opt out here, at the
    // one place every server-side query passes through.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}
