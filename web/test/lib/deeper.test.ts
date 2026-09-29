/** Where a failed category goes deeper. The tool links are pre-filled with the graded app, and a
 *  wrong parameter fails silently on the tool's side, so each format is pinned here. */
import { describe, it, expect } from "vitest";
import { deeperFor } from "@/lib/deeper";
import { CATEGORY_FACTS } from "@/lib/checks.generated";

const APP = "https://myapp.dev";

describe("deeperFor", () => {
  it("sends Lighthouse categories to PageSpeed Insights, on this app", () => {
    const d = deeperFor("web-vitals", APP)!;
    expect(d).toMatchObject({ kind: "tool", name: "PageSpeed Insights" });
    const u = new URL(d.href);
    expect(u.origin + u.pathname).toBe("https://pagespeed.web.dev/analysis");
    expect(u.searchParams.get("url")).toBe(APP);
  });

  it("sends accessibility to WAVE, the address raw after the hash", () => {
    expect(deeperFor("accessibility", APP)?.href).toBe("https://wave.webaim.org/report#/https://myapp.dev");
  });

  it("sends headers to the HTTP Observatory by host", () => {
    const u = new URL(deeperFor("security-headers", "https://myapp.dev:8443/")!.href);
    expect(u.origin + u.pathname).toBe("https://developer.mozilla.org/en-US/observatory/analyze");
    expect(u.searchParams.get("host")).toBe("myapp.dev");
  });

  it("keeps a reference page where no tool tests the thing", () => {
    // Lighthouse loads a page once, so it says nothing about behavior under load.
    expect(deeperFor("load-resilience", APP)).toMatchObject({ kind: "reference", name: "MITRE" });
    expect(deeperFor("sql-injection", APP)).toMatchObject({ kind: "reference", name: "OWASP" });
  });

  it("never offers a tool for an attack category", () => {
    for (const slug of ["sql-injection", "xss", "command-injection", "ssrf", "backend-exposure", "secrets-exposure"]) {
      expect(deeperFor(slug, APP)?.kind).not.toBe("tool");
    }
  });

  it("falls back to the reference page when the origin will not parse", () => {
    expect(deeperFor("web-vitals", "not a url")?.kind).toBe("reference");
  });

  it("returns nothing for an unknown category", () => {
    expect(deeperFor("no-such-category", APP)).toBeNull();
    expect(deeperFor("constructor", APP)).toBeNull();
  });

  it("names every category's publisher", () => {
    for (const c of CATEGORY_FACTS) {
      const d = deeperFor(c.slug, APP);
      if (d?.kind === "reference") expect(d.name).not.toMatch(/\./);
    }
  });
});
