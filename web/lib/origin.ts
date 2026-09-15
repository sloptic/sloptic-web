// Parse + normalize a user-submitted URL to the origin we will grade.
// An origin is scheme + host + port, lowercased, with no path/query/fragment. A grant (v2) authorizes
// only URLs under a verified origin, so this normalization is also a security boundary: keep it strict.

export interface NormalizedTarget {
  origin: string; // e.g. "https://example.com" or "https://example.com:8443"
  host: string; // lowercased hostname, no port
}

export class UrlRejected extends Error {}

/** Long enough for any real deployed URL, short enough that nothing absurd is stored per grade and
 *  re-served by every list view. */
const MAX_URL_LENGTH = 2048;

export function normalizeTarget(raw: unknown): NormalizedTarget {
  // Not typed as string at the callers' word: the body is parsed JSON, so `url` can be a number or
  // an array, and .trim() on one of those threw out of the route as a 500 instead of the 400 the
  // route documents.
  if (typeof raw !== "string") throw new UrlRejected("Enter a URL.");
  const trimmed = raw.trim();
  if (!trimmed) throw new UrlRejected("Enter a URL.");
  if (trimmed.length > MAX_URL_LENGTH) throw new UrlRejected("That URL is too long.");

  // The scheme is OPTIONAL, and defaults to https. Someone pasting an address types what they would
  // type into a browser's bar, and making them also type "https://" was friction with nothing behind
  // it: this function already accepted http:// and always has, so requiring the prefix protected
  // nothing, it only turned "myapp.com" into an error message.
  //
  // Matched on scheme FOLLOWED BY "//", not on a bare colon, and that distinction is the whole
  // reason this is a regex rather than a try/parse. `new URL("myapp.com:8080")` succeeds: it reads
  // "myapp.com:" as the scheme and "8080" as the path, so a host-and-port with no scheme would have
  // sailed past a parse check and then been rejected for having a protocol nobody typed.
  //
  // What this does NOT do is guess http for an app that only serves http. Nothing here fetches, so
  // there is nothing to fall back with; an http-only origin needs http:// spelled out until the
  // grader learns to try both. Defaulting the other way would be worse, since it would grade an
  // https app over plaintext and then deduct it for the downgrade we chose.
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new UrlRejected("Not a valid URL.");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UrlRejected("Only http and https URLs can be graded.");
  }

  // Credentials in a URL are two problems at once. `https://good.example.com@evil.example.com`
  // reads to a person as one host and is graded as another, and anything pasted in the userinfo
  // (a token, a password) would be stored on the grade and served back to every link holder.
  if (u.username || u.password) {
    throw new UrlRejected("Remove the username and password from the URL.");
  }

  // A trailing dot is the same name to a resolver and a different string to endsWith, so it is
  // taken off before the internal-name gate below rather than sailing through it.
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".")) {
    throw new UrlRejected("Enter a public hostname, e.g. your-app.example.com");
  }

  // Reject obvious internal names at the parse layer. This is NOT the egress sandbox (which must
  // resolve DNS and block by resolved IP); it is a cheap first gate. See lib/egress.ts.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UrlRejected("That host cannot be graded.");
  }

  const origin = u.port ? `${u.protocol}//${host}:${u.port}` : `${u.protocol}//${host}`;
  return { origin, host };
}
