import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeTarget, UrlRejected } from "@/lib/origin";
import { egressPrecheck } from "@/lib/egress";
import { allow, clientIp, hashIp } from "@/lib/ratelimit";
import { gradingOpen, GRADING_CLOSED_MESSAGE, maxQueueDepth, QUEUE_FULL_MESSAGE } from "@/lib/flags";
import { currentUser } from "@/lib/auth";

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

  // 4. Refuse rather than queue someone into a timeout. The worker fails any grade left queued past
  // its window, so accepting past what the queue can clear does not serve the visitor, it just moves
  // the refusal an hour later and dresses it as a failure. Counted after the rate limit so a burst
  // from one address is already gone by here.
  const db = supabaseAdmin();
  const { count: waiting, error: depthErr } = await db
    .from("grades")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");
  // A failed count is not evidence of a full queue. Let it through: the queue timeout is the
  // backstop, and refusing on an unreadable count would close the site on a transient database blip.
  if (depthErr) console.error("queue depth unreadable:", depthErr.message);
  if (!depthErr && (waiting ?? 0) >= maxQueueDepth()) {
    return NextResponse.json({ error: QUEUE_FULL_MESSAGE, waiting }, { status: 503 });
  }

  // 5. Enqueue, attached to the account if there is one. Without this a signed-in user's own grade
  // lands unowned and quietly expires unless they later go and claim it, which makes signing in
  // look like it does nothing.
  const user = await currentUser();
  const { data, error } = await db
    .from("grades")
    .insert({
      origin: target.origin,
      submitted_url: (body.url || "").trim(),
      mode: "passive",
      status: "queued",
      submitter_ip_hash: ipHash,
      account_id: user?.id ?? null,
    })
    .select("id, status, origin")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not enqueue the grade." }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, status: data.status, origin: data.origin }, { status: 202 });
}
