import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { parseEventSlug, BadEvent } from "@/lib/devpost-slug";
import { mayOverrideEvents } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/run  { event, mode }  ->  start RESOLVING the field. Grades nothing.
//
// The run's first job is to work out what would be graded and show it. Nothing is probed until the
// organizer confirms, because confirming is them authorizing traffic at other people's apps.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { event?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { event }." }, { status: 400 });
  }

  let slug: string;
  try {
    slug = parseEventSlug(body.event || "");
  } catch (e) {
    if (e instanceof BadEvent) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const db = supabaseAdmin();

  // A live grant for THIS account and THIS event. Never "is this event verified": a grant someone
  // else earned authorizes them, not the caller.
  const { data: grant } = await db
    .from("grants")
    .select("scope, expires_at")
    .eq("account_id", user.id)
    .eq("kind", "organizer_event")
    .eq("scope", slug)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  const override = !grant && mayOverrideEvents(user.email);
  if (!grant && !override) {
    return NextResponse.json(
      { error: "Verify that you run this event first." },
      { status: 403 }
    );
  }

  // Active needs the disclosure to have existed before entrants submitted, which is recorded on the
  // claim at verification time. An override run is passive whatever was asked for.
  let mode: "passive" | "active" = body.mode === "active" ? "active" : "passive";
  if (override) mode = "passive";
  if (mode === "active") {
    const { data: claim } = await db
      .from("event_claims")
      .select("window_open_at_verification")
      .eq("account_id", user.id)
      .eq("slug", slug)
      .eq("status", "verified")
      .maybeSingle();
    if (claim?.window_open_at_verification !== true) {
      return NextResponse.json(
        {
          error:
            "This event was not verified before its submission deadline, so entries get the passive checks only.",
        },
        { status: 409 }
      );
    }
  }

  // One live run per event per account. A second resolve while one is in flight would grade the
  // field twice.
  const { data: live } = await db
    .from("event_runs")
    .select("id, status")
    .eq("account_id", user.id)
    .eq("slug", slug)
    .in("status", ["resolving", "ready", "grading"])
    .maybeSingle();
  if (live) return NextResponse.json({ run: live, existing: true });

  const { data, error } = await db
    .from("event_runs")
    .insert({ account_id: user.id, slug, mode, override })
    .select("id, slug, mode, status, override")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not start the run." }, { status: 500 });
  }
  if (override) console.warn(`[override] ${user.email} started a passive run on ${slug}`);
  return NextResponse.json({ run: data, existing: false }, { status: 201 });
}

// GET /api/events/run?slug=... -> this account's runs, with the resolved field.
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ runs: [] });

  const slug = new URL(req.url).searchParams.get("slug");
  let q = db_runs(user.id);
  if (slug) q = q.eq("slug", slug);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "Could not list runs." }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}

function db_runs(accountId: string) {
  return supabaseAdmin()
    .from("event_runs")
    .select(
      "id, slug, mode, status, override, entries_found, gallery_complete, detail, created_at, resolved_at, " +
        // The grade's own status and progress ride along, so the events page can show a field
        // filling in without asking per entry.
        "event_entries(project_url, app_url, skip_reason, grade_id, grades(status, progress))"
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(20);
}
