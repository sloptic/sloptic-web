import type { MetadataRoute } from "next";

/** A grade report lives at an unguessable URL and that URL is the only thing gating it, so a
 *  crawler that finds one link (a paste in a Discord, a Devpost comment) would put the report in a
 *  search index and undo the whole model. Keep the marketing pages indexable, keep reports out.
 *
 *  Shared scores (/s/<token>) are deliberately NOT disallowed. Link previews are fetched by crawlers
 *  (Twitterbot and LinkedInBot honour robots.txt), and a disallowed share page unfurls as a bare URL.
 *  The page itself says noindex, and it shows only the summary a sharer chose to post. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/grade/", "/grades", "/api/"] }],
  };
}
