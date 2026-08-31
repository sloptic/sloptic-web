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

  // Mirror the account into profiles, with the service role: a user must not write their own record.
  //
  // terms_accepted_at is deliberately NOT set. There are no terms to accept yet, and stamping a
  // date would manufacture evidence of an agreement nobody made. It stays null until a terms page
  // exists and the sign-in form actually says so, which is also the gate the active tier needs.
  try {
    await supabaseAdmin()
      .from("profiles")
      .upsert({ id: data.user.id, email: data.user.email }, { onConflict: "id" });
  } catch {
    // A profile row is bookkeeping; failing it must not strand a signed-in user with no way back.
  }

  return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
}
