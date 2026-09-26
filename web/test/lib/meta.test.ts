/** Share cards. Next merges metadata one top-level key at a time, so a page that set only a title and
 *  description kept the layout's openGraph and twitter blocks, and every page unfurled as the landing
 *  page. These pin each public page's card to its own title and description. */
import { describe, it, expect } from "vitest";
import type { Metadata } from "next";
import { CARD_IMAGE, pageMeta } from "@/lib/meta";
import * as ogImage from "@/app/opengraph-image";

import * as about from "@/app/about/page";
import * as checks from "@/app/checks/page";
import * as findings from "@/app/findings/page";
import * as methodology from "@/app/methodology/page";
import * as organizers from "@/app/organizers/page";
import * as privacy from "@/app/privacy/page";
import * as reportIssue from "@/app/report-issue/page";
import * as terms from "@/app/terms/page";
import * as verify from "@/app/verify/page";

const PAGES: [string, { metadata: Metadata }][] = [
  ["/about", about],
  ["/checks", checks],
  ["/findings", findings],
  ["/methodology", methodology],
  ["/organizers", organizers],
  ["/privacy", privacy],
  ["/report-issue", reportIssue],
  ["/terms", terms],
  ["/verify", verify],
];

describe("pageMeta", () => {
  it("carries the title and description into both cards", () => {
    const m = pageMeta("T", "D", "/x");
    expect(m.openGraph).toMatchObject({ title: "T", description: "D", url: "/x" });
    expect(m.twitter).toMatchObject({ title: "T", description: "D" });
  });

  it("names the card image the image file actually draws", () => {
    // Setting openGraph drops the file's own image from the page, so the card restates it.
    expect(CARD_IMAGE).toMatchObject({ ...ogImage.size, alt: ogImage.alt });
    const m = pageMeta("T", "D", "/x");
    expect(m.openGraph).toMatchObject({ images: [CARD_IMAGE] });
    expect(m.twitter).toMatchObject({ images: [CARD_IMAGE] });
  });

  it("leaves og:url out when no path is given", () => {
    expect(pageMeta("T", "D").openGraph).not.toHaveProperty("url");
  });
});

describe.each(PAGES)("%s", (path, mod) => {
  const m = mod.metadata;

  it("shares under its own title, description and address", () => {
    expect(m.openGraph).toMatchObject({ title: m.title, description: m.description, url: path });
    expect(m.twitter).toMatchObject({ title: m.title, description: m.description });
  });

  it("writes its description without em dashes", () => {
    expect(String(m.description)).not.toContain("—");
  });
});
