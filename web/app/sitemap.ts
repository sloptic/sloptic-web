import type { MetadataRoute } from "next";

// Only the pages robots.ts already allows, and only the ones that stand on their own. Reports and
// boards are deliberately absent: a report URL is the whole of its access control, and a sitemap is
// the one file built to hand URLs to crawlers.
const PAGES = ["", "/about", "/checks", "/findings", "/methodology", "/organizers", "/verify", "/privacy", "/terms"];

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sloptic.org";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.map((path) => ({
    url: `${SITE}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
