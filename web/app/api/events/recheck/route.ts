import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { suspensionFor } from "@/lib/suspension";
import { gradingUnavailable } from "@/lib/worker-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/recheck  { id }  ->  ask the worker to look again now.
//
// This only moves the claim's due time forward. The check itself belongs to the worker, which is the
// only side inside the egress sandbox and on the residential connection Devpost will answer.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // Suspended accounts spend no outbound traffic. This route makes the worker fetch Devpost or a
  // claimed origin, so it needs the same gate the grade path has.
  const suspended = await suspensionFor(user.id);
  if (suspended) return NextResponse.json({ error: suspended.reason }, { status: 403 });


  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { id }." }, { status: 400 });
  }

  // Scoped to the caller's own pending claims, so an id from somewhere else reaches nothing.
  // LAST, not first. This is a cheap global refusal and the checks above it are about the CALLER:
  // who they are, whether the thing is theirs, and whether they have asked too often. Refusing
  // availability ahead of those turns a 404 and a 429 into a 503, which loses the answer the
  // caller needed and stops an outage from counting against anyone's rate limit. Same position the
  // grade door puts it in: everything about the request first, then whether we can serve it.
  const down = await gradingUnavailable(supabaseAdmin(), "check");
  if (down) return down;
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
