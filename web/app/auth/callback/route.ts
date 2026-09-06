import { NextResponse, type NextRequest } from "next/server";
import { supabaseSession } from "@/lib/auth";
import { mirrorProfile } from "@/lib/profile";
import { safeNext } from "@/lib/redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where an OAuth sign-in lands: a provider comes back as a `code` to exchange for a session, so
// adding Google or GitHub later needs no change here.
//
// Emailed links land on /auth/confirm instead, which redeems a token hash. They were split so the
// link inside the email could be on our own domain rather than the Supabase API host.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  // Parsed, not prefix-checked: see lib/redirect.
  const next = safeNext(searchParams.get("next"));

  if (!code) return NextResponse.redirect(`${origin}/signin?error=missing_code`);

  const supabase = supabaseSession();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(`${origin}/signin?error=exchange_failed`);

  // Shared with /auth/confirm so the two sign-in landings cannot drift on terms_accepted_at,
  // which is what the active tier rests on.
  await mirrorProfile(data.user);

  return NextResponse.redirect(`${origin}${next}`);
}
