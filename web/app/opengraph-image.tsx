import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { MARK_DATA_URI } from "@/lib/brand";

// The card every shared link renders as, in Slack, Discord, iMessage and every social preview.
// Report and board links are the ones that actually travel, so until this existed a shared grade
// was a text-only card, which reads as a site that is not finished.
//
// Generated from JSX rather than committed as a PNG so it stays editable in review: a binary would
// need whoever changes the palette to also find and redraw it, which is how a brand drifts.
//
// The font is vendored beside this file rather than fetched. next/og needs real font data (its
// default is a sans, and the wordmark is mono), and a build that reaches out to Google Fonts fails
// closed on a network blip, which would silently drop the image from every preview.

export const runtime = "nodejs";
export const alt = "Sloptic, a slop score for any deployed web app";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The site's light palette, from globals.css. Deliberately NOT theme-aware: a preview card is
// rendered once and cached by whoever unfurls it, so it has one appearance and it should be the
// one on the site's own paper.
const PAPER = "#f3f0e6";
const INK = "#1e211b";
const MUTED = "#6b6f61";
const LINE = "#d8d3c1";

export default async function Image() {
  // Read from disk, not fetched. `new URL(..., import.meta.url)` resolves to a /_next/static asset
  // path, which has no origin to fetch during prerender and fails the build.
  const mono = await readFile(join(process.cwd(), "app/_fonts/IBMPlexMono-SemiBold.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: "72px 80px",
          fontFamily: "PlexMono",
        }}
      >
        {/* The mark, at the size it was drawn for. Satori will not take an inline <svg>, so it
            arrives as a data URI; see lib/brand. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK_DATA_URI} width={132} height={132} alt="" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 132, color: INK, letterSpacing: "-0.02em", lineHeight: 1 }}>
            sloptic
          </div>
          <div style={{ marginTop: 28, fontSize: 40, color: MUTED, letterSpacing: "-0.01em" }}>
            grades any web app
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            paddingTop: 28,
            borderTop: `2px solid ${LINE}`,
            fontSize: 26,
            color: MUTED,
          }}
        >
          {/* Says what the number means without needing the site open. "Lower is better" is the
              one thing a stranger gets wrong about a slop score. */}
          <div style={{ display: "flex" }}>one number for how well it holds up, lower is better</div>
          <div style={{ display: "flex", color: INK }}>sloptic.org</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "PlexMono", data: mono, style: "normal", weight: 600 }],
    }
  );
}
