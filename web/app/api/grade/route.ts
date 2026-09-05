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

  let body: { url?: unknown; mode?: unknown };
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
  // Public submissions only. An event's grades sit in their own lane and the worker always serves a
  // person waiting on one grade first, so counting them here would let one 52 app field close the
  // site to everyone, which is the thing the lane exists to prevent.
  const { count: waiting, error: depthErr } = await db
    .from("grades")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .is("event_run_id", null);
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

  // 5a. The battery. PASSIVE unless this ACCOUNT has proved it owns this origin, and the server
  // decides that, never the caller: the client may ask, and asking is all it can do.
  //
  // Until now this was the string "passive" and nothing else, so owner verification granted
  // something no part of the site could spend. The grant is re-read here rather than trusted from
  // anywhere earlier, and the worker re-reads it AGAIN at grade time along with both proofs, which
  // is the layering CLAUDE.md asks for: no single check is the authorization.
  let mode: "passive" | "active" = "passive";
  if (body.mode === "active") {
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to run the full battery on a domain you have verified." },
        { status: 401 }
      );
    }
    const { data: grant } = await db
      .from("grants")
      .select("scope")
      .eq("account_id", user.id)
      .eq("kind", "app_origin")
      .eq("scope", target.origin)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!grant) {
      // Refused rather than quietly downgraded: someone who asked for the full battery and silently
      // got the passive floor would read the result as the whole story.
      return NextResponse.json(
        {
          error:
            "The full battery needs this origin verified by your account first. Verify it, then grade it.",
        },
        { status: 403 }
      );
    }
    mode = "active";
  }

  const { data, error } = await db
    .from("grades")
    .insert({
      origin: target.origin,
      submitted_url: typeof body.url === "string" ? body.url.trim() : "",
      mode,
      status: "queued",
      submitter_ip_hash: ipHash,
      account_id: user?.id ?? null,
    })
    .select("id, status, origin, mode")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not enqueue the grade." }, { status: 500 });
  }
  return NextResponse.json(
    { id: data.id, status: data.status, origin: data.origin, mode: data.mode },
    { status: 202 }
  );
}
