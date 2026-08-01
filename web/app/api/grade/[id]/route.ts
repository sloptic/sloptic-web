import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { GradeView, GradeResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/grade/:id  ->  poll status; includes the result once status === "done".
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: grade, error } = await db
    .from("grades")
    .select("id, status, submitted_url, submitted_at, error")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  if (!grade) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let result: GradeResult | null = null;
  if (grade.status === "done") {
    const { data: r } = await db
      .from("results")
      .select(
        "mode, catalog_version, passive_probe_count, slop_score, axis_slop, coverage, platform, surface, findings"
      )
      .eq("grade_id", params.id)
      .maybeSingle();
    result = (r as GradeResult) ?? null;
  }

  const view: GradeView = {
    id: grade.id,
    status: grade.status,
    url: grade.submitted_url,
    submitted_at: grade.submitted_at,
    error: grade.error,
    result,
  };
  return NextResponse.json(view);
}
