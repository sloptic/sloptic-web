// RFC 9116. The file a researcher's tooling looks for before it looks at a page, so it is the one
// thing that makes /report-issue findable by someone who never visits the site.
//
// Generated rather than committed as a static file, for one reason: the format REQUIRES an Expires
// date, and a committed one is a promise to remember it every year. A security.txt that has expired
// is worse than none, because it says the contact behind it is stale, which here would be false.
// Computing it per request means it cannot rot.

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sloptic.org";

export function GET() {
  // 364 days, not 365: the spec asks for less than a year, and exactly a year is not less than one.
  const expires = new Date(Date.now() + 364 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const body = [
    `Contact: mailto:security@sloptic.org`,
    `Expires: ${expires}`,
    `Preferred-Languages: en`,
    `Canonical: ${SITE}/.well-known/security.txt`,
    `Policy: ${SITE}/report-issue`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
