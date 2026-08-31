import { NextResponse, type NextRequest } from "next/server";
import { supabaseSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where every sign-in lands: a magic link and an OAuth provider both come back as a `code` to
// exchange for a session, so adding Google or GitHub later needs no change here.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";

  if (!code) return NextResponse.redirect(`${origin}/signin?error=missing_code`);

  const supabase = supabaseSession();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(`${origin}/signin?error=exchange_failed`);

  // Mirror the account into profiles and record that the terms were accepted at sign-in. Written
  // with the service role because a user must not be able to write their own acceptance record.
  try {
    await supabaseAdmin()
      .from("profiles")
      .upsert(
        {
          id: data.user.id,
          email: data.user.email,
          terms_accepted_at: new Date().toISOString(),
        },
        { onConflict: "id", ignoreDuplicates: false }
      );
  } catch {
    // A profile row is bookkeeping; failing it must not strand a signed-in user with no way back.
  }

  return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
}
