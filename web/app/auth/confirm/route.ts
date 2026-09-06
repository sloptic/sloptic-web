import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseSession } from "@/lib/auth";
import { mirrorProfile } from "@/lib/profile";
import { safeNext } from "@/lib/redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where an emailed sign-in link lands.
//
// This exists so the link in the email is on OUR domain. Supabase's `{{ .ConfirmationURL }}` points
// at the project's API host, so the magic link read
//
//     https://gtpypztolwyximzbhrtb.supabase.co/auth/v1/verify?token=...
//
// A random string at a domain the reader has never seen, in an email asking them to click it. That
// is the shape of a phishing mail, and no wording fixes it: an email that says "this is safe" is
// what an attacker sends. Supabase exposes `{{ .TokenHash }}` for exactly this, so the template
// builds a link to sloptic.org instead and this route redeems it. Now the advice a security tool
// should be giving ("check the domain before you click") is advice our own mail survives.
//
// OAuth still lands on /auth/callback: that flow returns a `code` to exchange, not a token hash.

// verifyOtp's type comes off the query string, so it is checked against the set rather than cast.
// An unexpected value is a link we did not build.
const EMAIL_OTP_TYPES = new Set<string>([
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
  "email",
]);

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  // Parsed, not prefix-checked: see lib/redirect for why "/<tab>/evil.com" defeats the obvious test.
  const next = safeNext(searchParams.get("next"));

  if (!tokenHash || !type || !EMAIL_OTP_TYPES.has(type)) {
    return NextResponse.redirect(`${origin}/signin?error=missing_code`);
  }

  const supabase = supabaseSession();
  const { data, error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });
  // An expired or already-spent link is the common case here, not an attack: the mail says it works
  // once and lasts an hour, and people find both edges. Back to sign-in, where they can ask for
  // another one, rather than an error page that offers nothing.
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/signin?error=exchange_failed`);
  }

  await mirrorProfile(data.user);
  return NextResponse.redirect(`${origin}${next}`);
}
