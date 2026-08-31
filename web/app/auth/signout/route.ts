import { NextResponse, type NextRequest } from "next/server";
import { supabaseSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST, not GET: a link prefetch or an image tag must never be able to sign someone out.
export async function POST(req: NextRequest) {
  await supabaseSession().auth.signOut();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
