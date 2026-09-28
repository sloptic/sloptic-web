/** /findings in both views. Full and passive grades are different measurements of the same apps, so
 *  a view must read only its own figures, and the numbers transcribed from the corpus report (full
 *  grades only) must not appear under passive. */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FindingsPage from "@/app/findings/page";
import { ACTIVE, PASSIVE } from "@/lib/corpus";

const render = (grades?: string) => renderToStaticMarkup(<FindingsPage searchParams={grades ? { grades } : {}} />);

describe("the findings page", () => {
  it("shows full grades by default, with the report's transcribed statistics", () => {
    const html = render();
    expect(html).toContain(`graded ${ACTIVE.attrition.graded.toLocaleString()} apps`);
    expect(html).toContain("p = 0.22");
    expect(html).toContain("About 4 in 5 of those have low contrast text.");
    expect(html).toMatch(/aria-current="page"[^>]*>full grades|>full grades<\/a>/);
  });

  it("shows passive grades from the passive figures, and none of the full-grade-only numbers", () => {
    const html = render("passive");
    expect(html).toContain(`graded ${PASSIVE.attrition.graded.toLocaleString()} apps`);
    expect(html).toContain(`median ${PASSIVE.distribution.median}`);
    for (const fullOnly of ["p = 0.22", "p = 0.003", "4 in 5", "Gemini"]) expect(html).not.toContain(fullOnly);
    expect(html).toContain("a passive grade can see");
  });

  it("marks the current view in the toggle, and links the other", () => {
    const passive = render("passive");
    expect(passive).toContain('href="/findings"');
    expect(passive).toMatch(/<a[^>]*aria-current="page"[^>]*>passive grades<\/a>/);
    expect(render()).toMatch(/<a[^>]*aria-current="page"[^>]*>full grades<\/a>/);
  });

  it("treats an unknown view as full grades", () => {
    expect(render("everything")).toContain(`graded ${ACTIVE.attrition.graded.toLocaleString()} apps`);
  });
});
