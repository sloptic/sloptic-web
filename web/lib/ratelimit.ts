import crypto from "node:crypto";
import { supabaseAdmin } from "./supabase";

// Fixed-window per-IP rate limit backed by the rate_limits table. Coarse and good enough for v1;
// the scale path is an edge/Redis limiter. We store a HASH of the IP, never the raw IP.

export function hashIp(ip: string): string {
  // A per-deploy salt keeps hashes from being trivially reversible across deployments.
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY || "sloptic";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function clientIp(headers: Headers): string {
  // Vercel/proxies set x-forwarded-for (client is the first entry).
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip") || "0.0.0.0";
}

/** Returns true if the request is allowed, false if the window quota is exhausted. */
export async function allow(ipHash: string): Promise<boolean> {
  const max = Number(process.env.RATE_LIMIT_MAX || 5);
  const windowSec = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 3600);

  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000).toISOString();

  const db = supabaseAdmin();
  // Atomic increment via upsert + returning is awkward without an RPC; do a read-modify-write.
  // Acceptable at v1 volume (grades are minutes apart per IP). Move to an RPC/Redis at scale.
  const { data } = await db
    .from("rate_limits")
    .select("count")
    .eq("ip_hash", ipHash)
    .eq("window_start", windowStart)
    .maybeSingle();

  const current = data?.count ?? 0;
  if (current >= max) return false;

  await db
    .from("rate_limits")
    .upsert(
      { ip_hash: ipHash, window_start: windowStart, count: current + 1 },
      { onConflict: "ip_hash,window_start" }
    );
  return true;
}
