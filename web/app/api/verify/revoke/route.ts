import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/verify/revoke  { id }  ->  give up a verified origin.
//
// Revocation has to be available and has to be immediate, because a grant is what lets attack
// payloads be aimed at a server: someone who sells a domain, or who changes their mind, must be able
// to take that back without asking us. The grant goes first, since it is the thing with force.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { id }." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Which claim?" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: claim } = await db
    .from("domain_claims")
    .select("id, origin, status")
    .eq("id", body.id)
    .eq("account_id", user.id)
    .maybeSingle();
  if (!claim) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { error: grantErr } = await db
    .from("grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("account_id", user.id)
    .eq("kind", "app_origin")
    .eq("scope", claim.origin)
    .is("revoked_at", null);
  if (grantErr) {
    return NextResponse.json({ error: "Could not revoke the grant." }, { status: 500 });
  }

  // A booked retry pass is authorization already spent that has not been sent yet: the blocked tail
  // of an active grade re-fires 12 to 28 minutes after it finished, and that tail is the injection
  // and upload families. Revoking has to reach it, or "Access is revoked" is false for half an hour.
  // The worker re-checks this lane too, so this is the belt to that suspenders.
  await db
    .from("grades")
    .update({ retry_due_at: null })
    .eq("account_id", user.id)
    .eq("origin", claim.origin)
    .not("retry_due_at", "is", null);

  // The claim follows. If this half fails the authorization is already gone, which is the half that
  // matters, so say what is true rather than implying nothing happened.
  const { error: claimErr } = await db
    .from("domain_claims")
    .update({ status: "revoked" })
    .eq("id", claim.id)
    .eq("account_id", user.id);
  if (claimErr) {
    console.error("claim revoke failed after grant revoke:", claimErr.message);
    return NextResponse.json({ revoked: true, warning: "Access is revoked; the record did not update." });
  }

  console.warn(`[owner] ${user.email} revoked ${claim.origin}`);
  return NextResponse.json({ revoked: true });
}
