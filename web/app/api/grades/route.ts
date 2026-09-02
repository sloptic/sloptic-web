import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { SUMMARY_SELECT, toSummary } from "@/lib/grades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/grades  ->  the signed-in account's grades. These are the ones that do not expire.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ grades: [] });

  const { data, error } = await supabaseAdmin()
    .from("grades")
    .select(SUMMARY_SELECT)
    .eq("account_id", user.id)
    // Grades you submitted, not every entry in an event you ran. Event grades carry the organizer's
    // account so their reports never expire, which is deliberate, but it also made a 52 app field
    // land in this list as though they were apps you had graded one by one. They belong on the
    // event's board.
    .is("event_run_id", null)
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: "Could not list grades." }, { status: 500 });
  return NextResponse.json({ grades: (data ?? []).map(toSummary) });
}
