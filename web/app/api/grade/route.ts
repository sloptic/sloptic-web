import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeTarget, UrlRejected } from "@/lib/origin";
import { egressPrecheck } from "@/lib/egress";
import { allow, clientIp, hashIp } from "@/lib/ratelimit";
import { gradingOpen, GRADING_CLOSED_MESSAGE } from "@/lib/flags";

export const runtime = "nodejs"; // needs node:dns / node:crypto; not edge
export const dynamic = "force-dynamic";

// POST /api/grade  ->  enqueue a passive grade. Returns { id, status: "queued" }.
export async function POST(req: NextRequest) {
  // Refuse before doing anything else. Without a worker a queued grade never finishes, and a 202
  // followed by a pending page that spins forever is worse than saying so plainly. This is the
  // authority; the form only mirrors it.
  if (!gradingOpen()) {
    return NextResponse.json({ error: GRADING_CLOSED_MESSAGE }, { status: 503 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { url }." }, { status: 400 });
  }

  // 1. Validate + normalize to an origin.
  let target;
  try {
    target = normalizeTarget(body.url || "");
  } catch (e) {
    if (e instanceof UrlRejected) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  // 2. Rate-limit by hashed IP.
  const ipHash = hashIp(clientIp(req.headers));
  if (!(await allow(ipHash))) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again later." },
      { status: 429 }
    );
  }

  // 3. Egress pre-check (cheap first gate; the authoritative sandbox is in the worker).
  const blocked = await egressPrecheck(target.host);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

  // 4. Enqueue.
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("grades")
    .insert({
      origin: target.origin,
      submitted_url: (body.url || "").trim(),
      mode: "passive",
      status: "queued",
      submitter_ip_hash: ipHash,
    })
    .select("id, status")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not enqueue the grade." }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, status: data.status }, { status: 202 });
}
