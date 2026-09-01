// Turning what an organizer pastes into a Devpost event slug.
//
// The slug is a DNS label: the event lives at <slug>.devpost.com, and `sloptic.devpost.pinned_host`
// on the worker builds that host and re-checks which host actually answered after redirects. This is
// input validation so we do not store junk, NOT the security boundary. The boundary is the worker's,
// which is the only side that ever fetches anything.

/** One DNS label: letters, digits and inner hyphens. Deliberately strict, since it becomes a hostname. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export class BadEvent extends Error {}

/**
 * Accepts `https://your-event.devpost.com/`, `your-event.devpost.com`, or a bare `your-event`.
 *
 * Note the host is matched by SUFFIX on a dot boundary and then required to be a single label, so
 * `evil-devpost.com` and `your-event.devpost.com.attacker.net` are both rejected rather than
 * quietly yielding a slug.
 */
export function parseEventSlug(input: string): string {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) throw new BadEvent("Enter your event's Devpost address.");

  const host = raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  if (!host) throw new BadEvent("Enter your event's Devpost address.");

  let slug = host;
  if (host.includes(".")) {
    if (!host.endsWith(".devpost.com")) {
      throw new BadEvent("That is not a Devpost event address. It should look like your-event.devpost.com.");
    }
    slug = host.slice(0, -".devpost.com".length);
  }

  if (!LABEL.test(slug)) {
    throw new BadEvent("That does not look like a Devpost event. Use the address of the event's own page.");
  }
  // devpost.com itself, and its www, are not events.
  if (slug === "www" || slug === "devpost") {
    throw new BadEvent("Use the address of your event's own page, not devpost.com.");
  }
  return slug;
}
