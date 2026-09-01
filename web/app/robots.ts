import type { MetadataRoute } from "next";

/** A grade report lives at an unguessable URL and that URL is the only thing gating it, so a
 *  crawler that finds one link (a paste in a Discord, a Devpost comment) would put the report in a
 *  search index and undo the whole model. Keep the marketing pages indexable, keep reports out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/grade/", "/grades", "/api/"] }],
  };
}
