import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/verify/forget  { id }  ->  take a finished claim off the list.
//
// Only a claim that is already over: revoked, or given up on. A pending or verified one is live
// state and is ended with /api/verify/revoke, which revokes the grant first. This route deletes
// nothing that authorises anything.
//
// The row is deleted rather than hidden because it is workflow state, not the record. What happened
// lives in `grants`, which keeps the revoked grant with its evidence, and that is the thing worth
// auditing. A dead claim row is a line on someone's account page that they cannot get rid of.
//
// No suspension check: this removes a row and sends nothing. Suspension stops an account spending
// our outbound traffic, and refusing here would only trap someone we cut off with a list they
// cannot tidy.
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

  // Scoped to the caller AND to the finished statuses, in the statement rather than in a check
  // before it: another account's row and a live row are both simply not matched.
  const { data, error } = await supabaseAdmin()
    .from("domain_claims")
    .delete()
    .eq("id", body.id)
    .eq("account_id", user.id)
    .in("status", ["revoked", "failed"])
    .select("id");

  if (error) return NextResponse.json({ error: "Could not remove that." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ removed: true });
}
