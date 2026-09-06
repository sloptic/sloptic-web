import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { normalizeTarget, UrlRejected } from "@/lib/origin";
import { egressPrecheck } from "@/lib/egress";
import { platformSuffix, PLATFORM_REFUSAL } from "@/lib/platform";
import { hashIp, clientIp, allow, bucket, VERIFY_LIMIT, MAX_LIVE_CLAIMS } from "@/lib/ratelimit";
import { claimsForAccount } from "@/lib/domain-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/verify/claim  { url, attest }  ->  issue a token for proving control of an origin.
//
// This route hands out a token and records an attestation. It does NOT decide anything: the proofs
// are read by the worker, because both are outbound fetches and the egress sandbox lives there
// (migration 0029 says why). Nothing here grants access, so the worst a caller can do by lying to it
// is create a claim for an origin they will then fail to prove.
//
// What it does have to get right is refusing the cases where the flow could not honestly succeed,
// and recording the attestation that makes an active grade lawful rather than merely possible.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // The same quota the grade path has, and for the same reason its comment gives: this is the other
  // route that makes the worker connect to a host the caller chose. Without it, normalizeTarget
  // accepts any port, so one signed-in account could file a claim per port and have the worker walk
  // a stranger's port range from a residential address, reading the result back off its own account
  // page. A separate bucket from grading, so neither spends the other's allowance.
  if (!(await allow(bucket("verify", req.headers), VERIFY_LIMIT))) {
    return NextResponse.json(
      { error: "Too many verification attempts. Try again later." },
      { status: 429 }
    );
  }

  let body: { url?: unknown; attest?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { url, attest }." }, { status: 400 });
  }

  // The attestation is a precondition, not a formality. CLAUDE.md lists it among the layers the
  // active tier rests on precisely so that abuse is traceable to someone who claimed ownership.
  if (body.attest !== true) {
    return NextResponse.json(
      { error: "Confirm that you own this site and authorize active testing of it." },
      { status: 400 }
    );
  }

  let target;
  try {
    target = normalizeTarget(body.url);
  } catch (e) {
    if (e instanceof UrlRejected) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  // Structural, not a policy choice: see lib/platform.
  const platform = platformSuffix(target.host);
  if (platform) return NextResponse.json({ error: PLATFORM_REFUSAL }, { status: 400 });

  // The same sandbox rule the grade path follows. Verification is an outbound fetch too, and an
  // origin that resolves internally must never become something the worker is asked to reach.
  const egress = await egressPrecheck(target.host);
  if (egress) return NextResponse.json({ error: egress }, { status: 400 });

  const db = supabaseAdmin();

  // An existing live claim is REUSED rather than reissued. Handing out a fresh token would silently
  // invalidate the file the owner already published, which reads as the flow being broken.
  const { data: existing } = await db
    .from("domain_claims")
    .select("id, origin, host, token, status, file_status, dns_status, detail, checked_at, verified_at")
    .eq("account_id", user.id)
    .eq("origin", target.origin)
    .in("status", ["pending", "verified"])
    .maybeSingle();
  if (existing) return NextResponse.json({ claim: existing, existing: true });

  // A rate limit bounds how fast claims arrive; this bounds how many stand. Each live claim is a
  // standing instruction to the worker to keep connecting to that origin on its own timer, so a
  // burst that stops does not stop the traffic. Counted after the reuse check above, so re-claiming
  // an origin already held never trips it.
  const { count: live } = await db
    .from("domain_claims")
    .select("id", { count: "exact", head: true })
    .eq("account_id", user.id)
    .in("status", ["pending", "verified"]);
  if ((live ?? 0) >= MAX_LIVE_CLAIMS) {
    return NextResponse.json(
      { error: `You can verify up to ${MAX_LIVE_CLAIMS} sites. Give one up to add another.` },
      { status: 429 }
    );
  }

  const token = `sloptic-${randomBytes(32).toString("base64url")}`;
  const { data, error } = await db
    .from("domain_claims")
    .insert({
      account_id: user.id,
      origin: target.origin,
      host: target.host,
      token,
      attested_ip_hash: hashIp(clientIp(req.headers)),
    })
    .select("id, origin, host, token, status, file_status, dns_status, detail, checked_at, verified_at")
    .single();

  if (error || !data) {
    // The partial unique index (0029) is the real guard against a double submit, so losing that race
    // means someone else's insert won and we should hand back what it created.
    if (error?.code === "23505") {
      const { data: won } = await db
        .from("domain_claims")
        .select("id, origin, host, token, status, file_status, dns_status, detail, checked_at, verified_at")
        .eq("account_id", user.id)
        .eq("origin", target.origin)
        .in("status", ["pending", "verified"])
        .maybeSingle();
      if (won) return NextResponse.json({ claim: won, existing: true });
    }
    console.error("domain claim insert failed:", error?.message);
    return NextResponse.json({ error: "Could not start verification." }, { status: 500 });
  }

  console.warn(`[owner] ${user.email} claimed ${target.origin}`);
  return NextResponse.json({ claim: data, existing: false }, { status: 201 });
}

// GET /api/verify/claim -> this account's claims, newest first.
//
// The token is included because the owner is the one publishing it, and it is not a secret: it is
// served on a public path and published in public DNS. Its security is positional, exactly as the
// event token's is: the proof is that THIS token appeared on THAT origin and in THAT zone.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ claims: [] });
  return NextResponse.json({ claims: await claimsForAccount(user.id) });
}
