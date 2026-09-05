import { supabaseAdmin } from "@/lib/supabase";

/** One owner-verification claim, as every surface that shows one needs it. */
export type Claim = {
  id: string;
  origin: string;
  host: string;
  token: string;
  status: "pending" | "verified" | "failed" | "revoked";
  file_status: "ok" | "not_found" | "blocked" | null;
  dns_status: "ok" | "not_found" | "blocked" | null;
  detail: string | null;
  checked_at: string | null;
  verified_at: string | null;
  /** When the grant this claim earned runs out, null when it holds none. */
  expires_at?: string | null;
};

const COLUMNS =
  "id, origin, host, token, status, file_status, dns_status, detail, checked_at, verified_at";

/** An account's claims, newest first, each carrying the expiry of the grant it earned.
 *
 *  One query, in one place, because three surfaces need it: /verify, /account, and the endpoint the
 *  page polls. It was written out twice before this and would have been three times.
 */
export async function claimsForAccount(accountId: string): Promise<Claim[]> {
  const db = supabaseAdmin();
  const [{ data: rows }, { data: grants }] = await Promise.all([
    db
      .from("domain_claims")
      .select(COLUMNS)
      .eq("account_id", accountId)
      .order("issued_at", { ascending: false })
      .limit(50),
    db
      .from("grants")
      .select("scope, expires_at")
      .eq("account_id", accountId)
      .eq("kind", "app_origin")
      .is("revoked_at", null),
  ]);

  // The expiry travels with the claim it came from, so a verified origin can say when it needs
  // proving again rather than looking permanent.
  const expiry = new Map((grants ?? []).map((g) => [g.scope as string, g.expires_at as string]));
  return (rows ?? []).map((c) => ({ ...c, expires_at: expiry.get(c.origin) ?? null })) as Claim[];
}
