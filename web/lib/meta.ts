import type { Metadata } from "next";

/** A page's title and description, carried into its share card.
 *
 *  Next merges metadata one top-level key at a time, so a page that sets only `title` and
 *  `description` inherits the layout's whole `openGraph` and `twitter` blocks. Every page unfurled
 *  in Slack, Discord or on X as "Sloptic" with the landing page's description, and an og:url that
 *  pointed at the landing page. Setting all three here keeps the card saying what the page says.
 *
 *  Setting openGraph also drops the image app/opengraph-image.tsx would have attached (Next adds the
 *  file's image only to a page that leaves openGraph alone), so the card names it itself. The alt and
 *  size are the image file's own exports, restated because importing the route here would pull
 *  next/og into every page; the test holds the two together.
 *
 *  `path` is omitted for a page whose address carries the event's token (the participant notice), so
 *  the card never repeats it.
 */
export const CARD_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Sloptic, a slop score for any deployed web app",
};

export function pageMeta(title: string, description: string, path?: string): Metadata {
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: "Sloptic",
      title,
      description,
      images: [CARD_IMAGE],
      ...(path ? { url: path } : {}),
    },
    twitter: { card: "summary_large_image", title, description, images: [CARD_IMAGE] },
  };
}
