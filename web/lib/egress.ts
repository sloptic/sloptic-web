// Egress pre-check for a submitted host, run at submit time so we reject an obviously-internal target
// before it ever reaches the queue.
//
// P0 / DEFERRED (see CLAUDE.md and the handoff): the AUTHORITATIVE egress sandbox lives in the worker's
// fetch path (worker/sloptic_web_worker/egress.py), because that is where every outbound fetch and every
// redirect actually happens. This function is only a cheap first gate: DNS can rebind between this check
// and the grade, and a redirect can walk off-origin, so this must NOT be treated as the security control.
// Until the worker chokepoint is implemented, DO NOT point the worker at untrusted URLs.

import dns from "node:dns/promises";
import net from "node:net";

// loopback, RFC1918, link-local, CGNAT, metadata, and unspecified ranges.
function isBlockedIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true; // loopback / unspecified
  if (low.startsWith("fe80")) return true; // link-local
  if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local fc00::/7
  if (low.startsWith("::ffff:")) return isBlockedIPv4(low.split(":").pop() || ""); // IPv4-mapped
  // The deprecated IPv4-compatible form, "::127.0.0.1". Still parses, still routes, and was walking
  // past a gate that stopped its ::ffff: sibling. The OS tier drops the packet either way; this is
  // the cheap check in front of it agreeing with itself.
  if (low.startsWith("::") && low.includes(".")) return isBlockedIPv4(low.slice(2));
  return false;
}

function isBlocked(ip: string): boolean {
  return net.isIPv6(ip) ? isBlockedIPv6(ip) : isBlockedIPv4(ip);
}

/** Resolve the host and reject if ANY resolved address is internal. Returns null if OK. */
export async function egressPrecheck(host: string): Promise<string | null> {
  // A literal IP submitted directly.
  if (net.isIP(host)) return isBlocked(host) ? "That host cannot be graded." : null;

  let addrs: string[] = [];
  try {
    const results = await dns.lookup(host, { all: true });
    addrs = results.map((r) => r.address);
  } catch {
    return "That host could not be resolved.";
  }
  if (addrs.length === 0) return "That host could not be resolved.";
  if (addrs.some(isBlocked)) return "That host cannot be graded.";
  return null;
}
