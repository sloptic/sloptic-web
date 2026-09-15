import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { gradingOpen } from "@/lib/flags";
import { workerLiveness } from "@/lib/worker-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/status -> what the UI needs to know before offering the form.
//
// Kept separate from /api/health because they answer different questions: this one asks "may I offer
// the form" and must never start alerting, while health asks "would a grade submitted now finish"
// for a monitor. The POST route is the authority either way; this only decides what to draw.
//
// It now consults the heartbeat as well as the flag, which is the difference between a planned
// outage that announces itself and one that silently eats a week of submissions. GRADING_OPEN stays
// as the deliberate switch; the heartbeat covers everything that happens without anyone deciding it,
// including the corpus runs where the worker is stopped on purpose.
export async function GET() {
  const flag = gradingOpen();
  // Skipped entirely when the flag is already off: the answer cannot change and there is no reason
  // to put a query behind every landing page view to confirm it.
  const worker = flag
    ? await workerLiveness(supabaseAdmin())
    : { alive: false, note: null, unreadable: false, ageSeconds: null };

  return NextResponse.json(
    {
      grading_open: flag && worker.alive,
      // Null unless an operator left one. The UI carries its own fallback, so a missing note is a
      // plainer message rather than an empty space where a sentence should be.
      note: worker.note,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
