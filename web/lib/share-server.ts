// The database half of sharing: find a grade by its report id or its share token, and build its
// card. Server only. It holds the service-role client, which must never reach a browser bundle.
//
// It selects the columns a card needs and nothing else. Findings are read only so the band can count
// failed checks per axis, and only those counts leave this module: no title, target or evidence ever
// reaches the share page or the card image. Outcomes and the report card never load here.

import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { shareCardFrom, type ShareCard, type ShareSource } from "@/lib/share";

/** Report ids are uuids; the id IS the report's capability. */
export const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A share token: 16 random bytes, base64url, so 22 characters. Nothing else is looked up. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** A fresh share token. 128 bits of randomness, so a token cannot be guessed or walked. */
export function mintShareToken(): string {
  return randomBytes(16).toString("base64url");
}

type GradeRow = {
  id: string;
  status: string;
  origin: string | null;
  submitted_url: string | null;
  retry_due_at: string | null;
  account_id: string | null;
  share_token: string | null;
};

const GRADE_COLS = "id, status, origin, submitted_url, retry_due_at, account_id, share_token";
const RESULT_COLS =
  "mode, slop_score, axis_slop, axis_potential, ruler, ranking, coverage, findings, blocked_probes, bot_challenge, challenge_stage";

export type LoadedShare = { grade: GradeRow; card: ShareCard | null };

/** Why a lookup failed, when it did. "missing" is the share_token column not being there yet
 *  (migration 0038 not applied), which the callers turn into "sharing is not available" rather
 *  than a 500 on a report that otherwise works. */
export type ShareLookup = { ok: true; share: LoadedShare | null } | { ok: false; reason: "missing" | "error" };

/** Find a grade by report id or share token and build its card. `share: null` means no such grade. */
export async function loadShare(by: { id: string } | { token: string }): Promise<ShareLookup> {
  const db = supabaseAdmin();
  const q = db.from("grades").select(GRADE_COLS);
  const { data: grade, error } = await ("id" in by ? q.eq("id", by.id) : q.eq("share_token", by.token)).maybeSingle();
  if (error) return { ok: false, reason: error.code === "42703" ? "missing" : "error" };
  if (!grade) return { ok: true, share: null };
  const g = grade as GradeRow;

  let result: ShareSource["result"] = null;
  if (g.status === "done") {
    const { data: r, error: rErr } = await db.from("results").select(RESULT_COLS).eq("grade_id", g.id).maybeSingle();
    // A read that failed is not a report that expired. Say so rather than show "no longer available".
    if (rErr) return { ok: false, reason: "error" };
    result = (r as ShareSource["result"]) ?? null;
  }

  // The verified-owner mark: the account that holds this report holds a live ownership grant for the
  // app. Asked of the REPORT's account, not the viewer's: the card says who stands behind the grade.
  // An unreadable grant is no mark, never a mark.
  let verifiedOwner = false;
  if (g.account_id && g.origin && result) {
    const { data: grant, error: gErr } = await db
      .from("grants")
      .select("scope")
      .eq("account_id", g.account_id)
      .eq("kind", "app_origin")
      .eq("scope", g.origin)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    verifiedOwner = !gErr && !!grant;
  }

  return { ok: true, share: { grade: g, card: shareCardFrom({ grade: g, result, verifiedOwner }) } };
}
