import { NextResponse } from "next/server";
import { gradingOpen } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/status -> what the UI needs to know before offering the form.
// Kept separate so the landing page stays statically rendered and still learns the current state at
// runtime; the POST route is the authority either way.
export async function GET() {
  return NextResponse.json(
    { grading_open: gradingOpen() },
    { headers: { "cache-control": "no-store" } },
  );
}
