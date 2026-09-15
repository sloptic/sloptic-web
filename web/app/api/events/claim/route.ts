import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { parseEventSlug, BadEvent } from "@/lib/devpost-slug";
import { suspensionFor } from "@/lib/suspension";
import { gradingUnavailable } from "@/lib/worker-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 144 bits, url-safe. The token is public by design (it goes on a public rules page and into a URL
 *  participants follow), so this length is not about secrecy. It is so that no two claims collide and
 *  nobody can enumerate the space and stumble onto a token some event happens to have published. */
function newToken(): string {
  return randomBytes(18).toString("base64url");
}

// POST /api/events/claim  { event }  ->  the token and the link to publish.
//
// Creating a claim proves nothing and grants nothing. It only issues a token; the proof is publishing
// that token on the event's own Devpost pages, which the worker reads back. Two accounts may hold
// pending claims on the same event, and only the one that can edit those pages will ever verify.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // Suspended accounts spend no outbound traffic. Checked at every entry point, not only here: a
  // suspension has to reach the paths that make the worker fetch something.
  const suspended = await suspensionFor(user.id);
  if (suspended) return NextResponse.json({ error: suspended.reason }, { status: 403 });


  let body: { event?: string };
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

  // An existing claim is returned rather than replaced. Re-issuing a token would invalidate the link
  // an organizer may already have published, so the second click would silently undo the first.
  const { data: existing } = await db
    .from("event_claims")
    .select("id, slug, token, status, check_status, checked_at")
    .eq("account_id", user.id)
    .eq("slug", slug)
    .in("status", ["pending", "verified"])
    .maybeSingle();
  if (existing) return NextResponse.json({ claim: existing, existing: true });

  // LAST, not first. This is a cheap global refusal and the checks above it are about the CALLER:
  // who they are, whether the thing is theirs, and whether they have asked too often. Refusing
  // availability ahead of those turns a 404 and a 429 into a 503, which loses the answer the
  // caller needed and stops an outage from counting against anyone's rate limit. Same position the
  // grade door puts it in: everything about the request first, then whether we can serve it.
  const down = await gradingUnavailable(supabaseAdmin(), "check");
  if (down) return down;
  const { data, error } = await db
    .from("event_claims")
    .insert({ account_id: user.id, slug, token: newToken() })
    .select("id, slug, token, status, check_status, checked_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not start the claim." }, { status: 500 });
  }
  return NextResponse.json({ claim: data, existing: false }, { status: 201 });
}

// GET /api/events/claim -> this account's claims.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ claims: [] });

  const { data, error } = await supabaseAdmin()
    .from("event_claims")
    .select("id, slug, token, status, check_status, check_detail, checked_at, verified_at, issued_at")
    .eq("account_id", user.id)
    .order("issued_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Could not list claims." }, { status: 500 });
  return NextResponse.json({ claims: data ?? [] });
}
