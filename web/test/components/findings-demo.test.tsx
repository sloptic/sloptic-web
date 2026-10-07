/** /findings-demo: the findings told as an investigation, from the same full-grade corpus as /findings,
 *  rounded for a room. */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FindingsDemoPage, { metadata } from "@/app/findings-demo/page";

// next/font only runs inside Next's compiler; here the serif only needs to hand back a class name.
vi.mock("next/font/google", () => ({ IBM_Plex_Serif: () => ({ variable: "font-serif", className: "" }) }));

describe("the findings investigation", () => {
  const html = renderToStaticMarkup(<FindingsDemoPage />);

  it("tells the winners finding in order, in the pinned chart's steps", () => {
    const q = html.indexOf("Are winners cleaner?");
    expect(q).toBeGreaterThan(-1);
    const a = html.indexOf("No, but not dirtier either.");
    const b = html.indexOf("But speed does differ");
    expect(a).toBeGreaterThan(q);
    expect(b).toBeGreaterThan(a);
  });

  it("rounds the corpus for a room", () => {
    expect(html).toContain("graded 1,500+ real apps");
    expect(html).toContain("98% have no content security policy");
    expect(html).not.toContain("1,579");
  });

  it("keeps an anchor for each section, so a demo can jump to one", () => {
    for (const id of ["clean", "miss", "ai-builders", "winners", "speed", "hackathons", "exploitable"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("renders every reveal visible, so the page reads with no script", () => {
    expect(html).not.toMatch(/class="reveal hidden/);
  });

  it("stays out of search", () => {
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
