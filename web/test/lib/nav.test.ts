import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { ACCOUNT, PRIMARY, REFERENCE, type NavLink } from "@/lib/nav";

const ALL: NavLink[] = [...PRIMARY, ...REFERENCE, ...ACCOUNT];
const WEB_ROOT = path.resolve(__dirname, "../..");

/** The file Next would render for a route, which is what "this link goes somewhere" means here. */
const pageFor = (href: string) =>
  path.join(WEB_ROOT, "app", href === "/" ? "" : href.slice(1), "page.tsx");

describe("the site navigation", () => {
  it("points every link at a page that exists", () => {
    // The masthead and the footer both render from this list, so a href with no page behind it
    // ships a dead link into both at once.
    for (const l of ALL) expect([l.href, existsSync(pageFor(l.href))]).toEqual([l.href, true]);
  });

  it("names every link", () => {
    for (const l of ALL) expect(l.label.trim().length).toBeGreaterThan(0);
  });

  it("uses root-relative hrefs, never an absolute URL", () => {
    // An absolute link would leave the site's own routing, and would break every preview deploy.
    for (const l of ALL) expect(l.href).toMatch(/^\/[a-z-]*$/);
  });

  it("lists each destination once, so no menu renders a page twice", () => {
    const hrefs = ALL.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("uses each label once, so two rows cannot read the same", () => {
    const labels = ALL.map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("writes the labels without em dashes, as the house style requires", () => {
    for (const l of ALL) expect(l.label).not.toMatch(/[—–]/);
  });

  it("keeps the pages that explain the grade in the reference list", () => {
    // These are the pages a reader goes looking for after a report, and the reason the list exists
    // at all: /findings once shipped into the masthead and not the footer, which on a phone meant it
    // could only be reached by typing the address.
    const hrefs = REFERENCE.map((l) => l.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/methodology", "/checks", "/verify", "/findings"]));
  });

  it("opens on grading an app", () => {
    expect(PRIMARY[0].href).toBe("/");
  });

  it("keeps the signed-in pages out of the lists everyone sees", () => {
    const open = [...PRIMARY, ...REFERENCE].map((l) => l.href);
    for (const l of ACCOUNT) expect(open).not.toContain(l.href);
  });
});
