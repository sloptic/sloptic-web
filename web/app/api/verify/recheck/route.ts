import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/verify/recheck  { id }  ->  ask the worker to look again now.
//
// Only moves the due time. The check itself is the worker's, and this route deliberately cannot
// verify anything: if it could, the proofs would be read by a process outside the egress sandbox.
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

  // Scoped to the caller. Another account's claim is a 404, not a 403: whether it exists is not
  // something to confirm to someone who does not own it.
  const db = supabaseAdmin();
  const { data: claim } = await db
    .from("domain_claims")
    .select("id, status")
    .eq("id", body.id)
    .eq("account_id", user.id)
    .maybeSingle();
  if (!claim) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (claim.status !== "pending") {
    return NextResponse.json({ error: `That claim is ${claim.status}.` }, { status: 409 });
  }

  const { error } = await db
    .from("domain_claims")
    .update({ check_due_at: new Date().toISOString() })
    .eq("id", claim.id)
    .eq("status", "pending");
  if (error) return NextResponse.json({ error: "Could not schedule the check." }, { status: 500 });
  return NextResponse.json({ checking: true });
}
