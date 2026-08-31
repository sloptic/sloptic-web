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

  // Mirror the account into profiles. Written with the service role because a user must not be able
  // to write their own acceptance record.
  //
  // Two steps, because terms_accepted_at records WHEN THEY FIRST accepted and must not be rewritten
  // on every sign-in: an acceptance date that always says "just now" cannot answer whether an
  // account agreed to the terms as they stood at the time, which is the only question it exists to
  // answer. So the upsert deliberately omits the column (leaving an existing value untouched), and
  // a second write fills it only where it is still null.
  try {
    const admin = supabaseAdmin();
    await admin
      .from("profiles")
      .upsert({ id: data.user.id, email: data.user.email }, { onConflict: "id" });
    await admin
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", data.user.id)
      .is("terms_accepted_at", null);
  } catch {
    // A profile row is bookkeeping; failing it must not strand a signed-in user with no way back.
  }

  return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
}
