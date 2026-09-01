import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { SUMMARY_SELECT, cleanIds, toSummary } from "@/lib/grades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/grades/lookup  { ids: string[] }  ->  summaries for a browser's own history.
//
// Unauthenticated on purpose, and it grants nothing new: each id is already the capability for its
// own report, so someone posting a list of ids can only learn about grades they could already open
// one by one. Ids are validated as uuids and capped, so this cannot be turned into a scan; guessing
// one is 122 bits of work.
export async function POST(req: NextRequest) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { ids }." }, { status: 400 });
  }

  const ids = cleanIds(body.ids);
  if (ids.length === 0) return NextResponse.json({ grades: [] });

  const { data, error } = await supabaseAdmin()
    .from("grades")
    .select(SUMMARY_SELECT)
    .in("id", ids)
    .order("submitted_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  return NextResponse.json({ grades: (data ?? []).map(toSummary) });
}
