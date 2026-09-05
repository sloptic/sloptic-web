import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { isAdmin, mayOverrideEvents } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/run/mode  { id, mode }  ->  change a run's battery after the gallery resolved.
//
// Two honest shapes. A loaded field with nothing graded yet flips the run in place: nothing was
// measured, so there is nothing to mix. A DONE run keeps its board and a new run starts on the
// SAME field, entries copied without their grade links, so the two batteries never share a
// ranking. Mid-grading refuses: two live runs for one event would make "the board" ambiguous.

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { id?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { id, mode }." }, { status: 400 });
  }
  const mode = body.mode === "active" ? "active" : "passive";
  if (!body.id) return NextResponse.json({ error: "Which run?" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: run } = await db
    .from("event_runs")
    .select("id, slug, mode, status, override, admin")
    .eq("id", body.id)
    .eq("account_id", user.id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (run.status !== "ready" && run.status !== "done") {
    return NextResponse.json(
      { error: `That run is ${run.status}. Only a ready run can switch in place, and a finished one forks.` },
      { status: 409 }
    );
  }
  if (run.mode === mode) {
    return NextResponse.json({ error: `Already a ${mode} run.` }, { status: 409 });
  }

  // The same gate as starting a run: a live organizer grant for this event, or operator admin.
  // Only admin skips the disclosure check, and only admin may take an override run active.
  const { data: grant } = await db
    .from("grants")
    .select("scope")
    .eq("account_id", user.id)
    .eq("kind", "organizer_event")
    .eq("scope", run.slug)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const admin = !grant && isAdmin(user.email);

  // Only the ACTIVE direction is gated. Going back to passive asks for less than the run already
  // has, and refusing it would strand an organizer whose verification lapsed mid-run on the louder
  // battery, which is the wrong way for this to fail.
  if (mode === "active") {
    if (run.override && !admin) {
      return NextResponse.json({ error: "An override run stays passive." }, { status: 409 });
    }
    // The grant was read and then used only to decide `admin`, so the only thing in front of the
    // attack battery was the claim row, and a claim keeps saying "verified" long after the grant it
    // produced expired or was revoked. /api/events/run refuses at this same authority, and the
    // worker re-checks per entry, so what was lost is the middle layer: the product told an
    // organizer their field was being actively graded while the worker refused every entry of it.
    if (!grant && !admin) {
      return NextResponse.json(
        { error: "Your verification for this event has lapsed. Verify it again to grade actively." },
        { status: 403 }
      );
    }
    if (!admin) {
      const { data: claim } = await db
        .from("event_claims")
        .select("window_open_at_verification")
        .eq("account_id", user.id)
        .eq("slug", run.slug)
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
  }

  // An override run going active is an operator action, and migration 0019 refuses a row that is
  // override + active without the admin flag set. Recording the privilege the switch was made under
  // is both what makes the write legal and what keeps the provenance honest: the run is no longer
  // only what it was created as.
  const nextAdmin = run.admin || (mode === "active" && run.override === true);
  if (nextAdmin && !run.admin) {
    console.warn(`[admin] ${user.email} took override run ${run.id} (${run.slug}) active`);
  }

  // Nothing measured yet: flip the run in place.
  if (run.status === "ready") {
    const { count } = await db
      .from("event_entries")
      .select("grade_id", { count: "exact", head: true })
      .eq("run_id", run.id)
      .not("grade_id", "is", null);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Some entries already have grades. Let the run finish; switching then grades this field again on a new run." },
        { status: 409 }
      );
    }
    const { error } = await db
      .from("event_runs")
      .update({ mode, admin: nextAdmin })
      .eq("id", run.id)
      .eq("status", "ready");
    if (error) return NextResponse.json({ error: "Could not switch it." }, { status: 500 });
    return NextResponse.json({ flipped: true, mode });
  }

  // Finished: same field, fresh run, clean tier. The old board keeps its own battery.
  if (run.status === "done") {
    const { data: src, error: srcErr } = await db
      .from("event_runs")
      .select("entries_found, gallery_complete, detail")
      .eq("id", run.id)
      .maybeSingle();
    const { data: created, error: cErr } = await db
      .from("event_runs")
      .insert({
        account_id: user.id,
        slug: run.slug,
        mode,
        override: run.override,
        admin: nextAdmin,
        status: "ready",
        entries_found: src?.entries_found ?? null,
        gallery_complete: src?.gallery_complete ?? null,
        detail: src?.detail ?? null,
        resolved_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (cErr || !created) return NextResponse.json({ error: "Could not start it." }, { status: 500 });
    const { data: entries } = await db
      .from("event_entries")
      .select("project_url, app_url, skip_reason")
      .eq("run_id", run.id);
    if (entries?.length) {
      const { error: eErr } = await db
        .from("event_entries")
        .insert(entries.map((e) => ({ run_id: created.id, ...e })));
      if (eErr) {
        // Rolled back by hand: PostgREST gives no transaction across two calls, and a half-copied
        // run would hold the event's one live slot while confirm graded 30 of 60 apps as if that
        // were the whole field. Migration 0013's point exactly.
        await db.from("event_entries").delete().eq("run_id", created.id);
        await db.from("event_runs").delete().eq("id", created.id);
        return NextResponse.json({ error: "Could not copy the field." }, { status: 500 });
      }
    }
    return NextResponse.json({ created: created.id, mode });
  }

  return NextResponse.json(
    { error: "That run is still going. Wait for it to finish, then switch." },
    { status: 409 }
  );
}
