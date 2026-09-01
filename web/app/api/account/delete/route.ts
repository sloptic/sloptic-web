import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/account/delete -> remove the signed-in account.
//
// Acts only on the caller's own id, taken from the verified session, never from the request body.
// Deleting the auth user is the single operation: profiles, grants and event_claims are ON DELETE
// CASCADE, and grades.account_id is ON DELETE SET NULL, so saved grades revert to anonymous and the
// ordinary 30 day sweep collects them. That split is deliberate (migration 0009): destroying an
// account should not erase the rate limiting and abuse history attached to grades it once claimed.
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { error } = await supabaseAdmin().auth.admin.deleteUser(user.id);
  if (error) {
    console.error("account delete failed:", error.message);
    return NextResponse.json({ error: "Could not delete the account." }, { status: 500 });
  }
  // The session cookie now points at a user that no longer exists. Clearing it is the sign-out route's
  // job, and the client redirects through it; a stale cookie authenticates nothing either way.
  return NextResponse.json({ deleted: true });
}
