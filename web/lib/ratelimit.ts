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
  // x-vercel-forwarded-for is written by the platform and cannot be set by the caller, so it comes
  // first. x-forwarded-for is a list a client can prepend to, and reading its first entry trusts
  // whatever they wrote; correct on Vercel today, since the platform replaces the header, but one
  // proxy that APPENDS instead would turn the limit below into a free bypass.
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "0.0.0.0";
}

/** Returns true if the request is allowed, false if the window quota is exhausted.
 *
 *  One statement, deliberately. The read-modify-write this replaces let a concurrent burst through:
 *  every request in it read the same count before any of them wrote, so twelve simultaneous
 *  submissions from one address all passed a limit of five. See migration 0026.
 *
 *  Fails CLOSED. This is the only quota standing between an anonymous caller and the worker
 *  fetching a URL of their choosing, so a database it cannot reach means no, not yes. */
export async function allow(ipHash: string): Promise<boolean> {
  const max = Number(process.env.RATE_LIMIT_MAX || 5);
  const windowSec = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 3600);

  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000).toISOString();

  const { data, error } = await supabaseAdmin().rpc("bump_rate_limit", {
    p_ip_hash: ipHash,
    p_window_start: windowStart,
    p_max: max,
  });
  if (error) {
    console.error("rate limit unavailable, refusing:", error.message);
    return false;
  }
  return data === true;
}
