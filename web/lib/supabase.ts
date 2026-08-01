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
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
