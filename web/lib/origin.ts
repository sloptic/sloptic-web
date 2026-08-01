// Parse + normalize a user-submitted URL to the origin we will grade.
// An origin is scheme + host + port, lowercased, with no path/query/fragment. A grant (v2) authorizes
// only URLs under a verified origin, so this normalization is also a security boundary: keep it strict.

export interface NormalizedTarget {
  origin: string; // e.g. "https://example.com" or "https://example.com:8443"
  host: string; // lowercased hostname, no port
}

export class UrlRejected extends Error {}

export function normalizeTarget(raw: string): NormalizedTarget {
  const trimmed = (raw || "").trim();
  if (!trimmed) throw new UrlRejected("Enter a URL.");

  // Require an explicit scheme; do not silently assume https for an arbitrary string.
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new UrlRejected("That does not look like a valid URL. Include https://");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UrlRejected("Only http and https URLs can be graded.");
  }

  const host = u.hostname.toLowerCase();
  if (!host || !host.includes(".")) {
    throw new UrlRejected("Enter a public hostname, e.g. https://your-app.example.com");
  }

  // Reject obvious internal names at the parse layer. This is NOT the egress sandbox (which must
  // resolve DNS and block by resolved IP); it is a cheap first gate. See lib/egress.ts.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UrlRejected("That host cannot be graded.");
  }

  const origin = u.port ? `${u.protocol}//${host}:${u.port}` : `${u.protocol}//${host}`;
  return { origin, host };
}
