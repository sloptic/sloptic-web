import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { allow, bucket, VERIFY_LIMIT } from "@/lib/ratelimit";
import { suspensionFor } from "@/lib/suspension";
import { gradingUnavailable } from "@/lib/worker-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/verify/renew  { id, attest }  ->  ask for another term on a domain already verified.
//
// A grant lasts 90 days and nothing renewed it, so a verified domain became permanently unusable on
// day 91 with no way back except giving it up and re-adding it, which issues a NEW token and asks
// the owner to republish a file and a DNS record that were both already correct. This is the way
// back, and it keeps the token they published.
//
// Like recheck, this route decides NOTHING. It records that the owner attested again and brings the
// next check forward; the worker re-reads both proofs and writes the grant, because the worker is
// the side inside the egress sandbox. A route that could renew on its own would be a route that
// hands out active-testing rights with nobody looking at the origin.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // Suspended accounts spend no outbound traffic. Checked at every entry point, not only here: a
  // suspension has to reach the paths that make the worker fetch something.
  const suspended = await suspensionFor(user.id);
  if (suspended) return NextResponse.json({ error: suspended.reason }, { status: 403 });


  if (!(await allow(bucket("verify", req.headers), VERIFY_LIMIT))) {
    return NextResponse.json({ error: "Too many checks. Try again later." }, { status: 429 });
  }

  let body: { id?: string; attest?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body { id, attest }." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Which claim?" }, { status: 400 });

  // Re-attested, not merely re-clicked. This is what the expiry is FOR: proofs keep answering long
  // after a domain changes hands, so what a term ends is a person's standing claim to own it.
  // Renewing without asking again would make the 90 days decorative.
  if (body.attest !== true) {
    return NextResponse.json(
      { error: "Confirm that you still own this site and authorize active testing of it." },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data: claim } = await db
    .from("domain_claims")
    .select("id, status")
    .eq("id", body.id)
    .eq("account_id", user.id)
    .maybeSingle();
  if (!claim) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // Only a verified claim renews. A pending one is already on a faster timer, and a revoked or
  // failed one has no term to extend: it has to be added again.
  if (claim.status !== "verified") {
    return NextResponse.json(
      { error: `That claim is ${claim.status}, so there is no term to renew.` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  // LAST, not first. This is a cheap global refusal and the checks above it are about the CALLER:
  // who they are, whether the thing is theirs, and whether they have asked too often. Refusing
  // availability ahead of those turns a 404 and a 429 into a 503, which loses the answer the
  // caller needed and stops an outage from counting against anyone's rate limit. Same position the
  // grade door puts it in: everything about the request first, then whether we can serve it.
  const down = await gradingUnavailable(supabaseAdmin(), "check");
  if (down) return down;
  const { error } = await db
    .from("domain_claims")
    .update({ renew_requested_at: now, check_due_at: now })
    .eq("id", claim.id)
    .eq("account_id", user.id)
    .eq("status", "verified");
  if (error) return NextResponse.json({ error: "Could not request a renewal." }, { status: 500 });

  return NextResponse.json({ renewing: true });
}
