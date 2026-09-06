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
export async function allow(
  ipHash: string,
  opts: { max?: number; windowSec?: number } = {}
): Promise<boolean> {
  const max = opts.max ?? Number(process.env.RATE_LIMIT_MAX || 5);
  const windowSec = opts.windowSec ?? Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 3600);

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

/** A bucket that is not the grading bucket.
 *
 *  Verification makes the worker fetch a host and port the caller chose, exactly as grading does, so
 *  it needs its own quota rather than none. Namespacing through hashIp gives one without a migration:
 *  bump_rate_limit is keyed on the hash alone, so a different input is a different row. Keeping it
 *  separate from the grade bucket means neither can spend the other's allowance. */
export function bucket(ns: string, headers: Headers): string {
  return hashIp(`${ns}:${clientIp(headers)}`);
}

// Verification is cheap for the caller and expensive for us: every claim is a TLS connection from a
// residential line to a host somebody else picked. These are per hour, per address.
export const VERIFY_LIMIT = { max: 20, windowSec: 3600 };
// A live claim is a standing instruction to keep connecting to that origin, so the count of them is
// the real limit, not the rate. Twenty domains is far past any honest account and far short of a
// scan.
export const MAX_LIVE_CLAIMS = 20;
