import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/recheck  { id }  ->  ask the worker to look again now.
//
// This only moves the claim's due time forward. The check itself belongs to the worker, which is the
// only side inside the egress sandbox and on the residential connection Devpost will answer.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { id }." }, { status: 400 });
  }

  // Scoped to the caller's own pending claims, so an id from somewhere else reaches nothing.
  const { data, error } = await supabaseAdmin()
    .from("event_claims")
    .update({ check_due_at: new Date().toISOString() })
    .eq("id", body.id ?? "")
    .eq("account_id", user.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not queue the check." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No pending claim to check." }, { status: 404 });
  return NextResponse.json({ queued: true });
}
