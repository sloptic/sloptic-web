import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { cleanIds } from "@/lib/grades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/grades/claim  { ids: string[] }  ->  attach this browser's grades to the account.
//
// Only unowned grades are claimable, so a claim is first come and can never take a grade off the
// account already holding it. That is the honest limit of a bearer model: anyone with the URL has
// full read access anyway, and claiming buys persistence, not privacy.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { ids }." }, { status: 400 });
  }

  const ids = cleanIds(body.ids);
  if (ids.length === 0) return NextResponse.json({ claimed: [] });

  const { data, error } = await supabaseAdmin()
    .from("grades")
    .update({ account_id: user.id })
    .in("id", ids)
    .is("account_id", null)
    .select("id");

  if (error) return NextResponse.json({ error: "Could not claim." }, { status: 500 });
  return NextResponse.json({ claimed: (data ?? []).map((r) => r.id as string) });
}
