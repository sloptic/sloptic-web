import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/account/notify  { on }  ->  turn "your grade is ready" mail on or off.
//
// Opt OUT, not in: someone who submitted a grade asked for its result, so the mail is expected.
// What they did not ask for is a setting they must find and enable to be told their own work
// finished.
//
// No suspension check here, on purpose. A suspended account may still read its own reports and
// manage its own settings; what suspension stops is spending our outbound traffic, and turning a
// preference off sends nothing. Refusing would also be perverse: it would trap someone we cut off
// into mail they cannot switch off.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { on?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { on }." }, { status: 400 });
  }
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "Send { on: true } or { on: false }." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db.from("profiles").update({ notify_email: body.on }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Could not save that." }, { status: 500 });

  // Turning it off clears the backlog rather than parking it. The worker's queue is "finished and
  // not yet told", and being opted out only FILTERS that set, it does not empty it: a month of
  // grades finishing while the switch was off would all arrive the moment it went back on. Nobody
  // wants thirty messages about work they did in July as the price of turning notifications on.
  if (body.on === false) {
    await db
      .from("grades")
      .update({ notified_at: new Date().toISOString() })
      .eq("account_id", user.id)
      .eq("status", "done")
      .is("notified_at", null);
  }

  return NextResponse.json({ notify_email: body.on });
}
