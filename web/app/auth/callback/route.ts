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
  // terms_accepted_at is stamped here now that /terms exists and the sign-in form says that signing
  // in accepts it. Until both were true this stayed null on purpose, because a date written for an
  // agreement nobody was shown is manufactured evidence, and this column is what the active tier
  // rests on. Only set on first write: the date records when the account accepted, and re-stamping
  // it on every sign-in would lose that and silently re-date consent to the current terms.
  try {
    const db = supabaseAdmin();
    await db.from("profiles").upsert({ id: data.user.id, email: data.user.email }, { onConflict: "id" });
    // Stamped only where it is still null. An upsert carrying the date would rewrite it on every
    // sign-in, so the column would always read "today" and stop being evidence of when this account
    // accepted anything, which is the one job it has.
    await db
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", data.user.id)
      .is("terms_accepted_at", null);
  } catch {
    // A profile row is bookkeeping; failing it must not strand a signed-in user with no way back.
  }

  return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
}
