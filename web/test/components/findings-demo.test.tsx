/** /findings-demo: the showcase reads the same full-grade corpus as /findings, rounded for a room. */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FindingsDemoPage, { metadata } from "@/app/findings-demo/page";

describe("the findings showcase", () => {
  const html = renderToStaticMarkup(<FindingsDemoPage />);

  it("asks each question before its answer", () => {
    const q = html.indexOf("Are hackathon winners cleaner?");
    expect(q).toBeGreaterThan(-1);
    expect(html.indexOf("No, but not dirtier either.")).toBeGreaterThan(q);
    expect(html.indexOf("But they&#x27;re heavier.")).toBeGreaterThan(q);
  });

  it("rounds the corpus for a room", () => {
    expect(html).toContain("<b>1,500+</b>");
    expect(html).toContain(">98%<");
    expect(html).not.toContain("1,579");
  });

  it("renders every reveal visible, so the page reads with no script", () => {
    expect(html).not.toMatch(/class="reveal hidden/);
  });

  it("stays out of search", () => {
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
