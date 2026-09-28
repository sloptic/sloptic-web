import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { REPORT_ID, loadShare, mintShareToken } from "@/lib/share-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/grade/:id/share  ->  the share link for this report, minted the first time it is asked for.
//
// Whoever holds the report URL may ask, the same people who can already read it: the share shows
// less than the report does (a summary, never a finding), so it grants nothing the caller lacked.
// What it must never do is hand out the report URL itself, which is why the share is a separate
// random token and /s/<token> leads nowhere else.
//
// Idempotent: a report has at most one share link, so every "Copy link" hands back the same URL and
// a link already posted keeps working.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!REPORT_ID.test(params.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const found = await loadShare({ id: params.id });
  if (!found.ok) {
    return found.reason === "missing"
      ? NextResponse.json({ error: "Sharing is not available yet." }, { status: 503 })
      : NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
  if (!found.share) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Nothing honest to post: unfinished, withheld by a bot challenge, from before 3.0, or expired.
  if (!found.share.card) {
    return NextResponse.json({ error: "This report has no score to share." }, { status: 409 });
  }

  const link = (token: string) => ({ token, url: `${new URL(req.url).origin}/s/${token}` });
  if (found.share.grade.share_token) return NextResponse.json(link(found.share.grade.share_token));

  // Written only where none exists yet, so two first shares at once cannot leave two live links: the
  // loser of the race writes nothing, and reads back the winner's token.
  const db = supabaseAdmin();
  const token = mintShareToken();
  const { data: written, error } = await db
    .from("grades")
    .update({ share_token: token })
    .eq("id", params.id)
    .is("share_token", null)
    .select("share_token");
  if (error) return NextResponse.json({ error: "Could not create a share link." }, { status: 500 });
  if (written && written.length > 0) return NextResponse.json(link(token));

  const { data: again, error: againErr } = await db
    .from("grades")
    .select("share_token")
    .eq("id", params.id)
    .maybeSingle();
  if (againErr || !again?.share_token) {
    return NextResponse.json({ error: "Could not create a share link." }, { status: 500 });
  }
  return NextResponse.json(link(again.share_token as string));
}
