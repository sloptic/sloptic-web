/** The verdict band, shared by the report and the landing page's sample.
 *
 *  It is shared because it was not, and the sample drifted into a picture of an older report. These
 *  tests pin the behaviour that differed: what the toggle changes, which segments each view draws,
 *  and which keys the legend shows. A drift now fails here rather than being noticed months later
 *  by someone comparing two screens.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import ScoreBand, { fmtScore, type AxisRow } from "@/app/ScoreBand";

const ROWS: AxisRow[] = [
  { id: "security", label: "security", failed: 4, applied: 9, possible: 17, slop: 20, potential: 46 },
  { id: "qa", label: "quality", failed: 3, applied: 8, possible: 15, slop: 14, potential: 38 },
  { id: "performance", label: "performance", failed: 2, applied: 6, possible: 12, slop: 8, potential: 26 },
];

function band(over: Partial<React.ComponentProps<typeof ScoreBand>> = {}) {
  return render(<ScoreBand score={42} mode="passive" rows={ROWS} {...over} />);
}

const track = (label: string) =>
  document.querySelector(`.sample-axis[data-axis="${label}"] .sample-axis-track`)!;

describe("the score", () => {
  it("names the number rather than describing its direction", () => {
    // The sample used to say "lower is better" here while the report said "slop score". The
    // direction belongs in the hero; the band labels what the number IS.
    band();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("slop score")).toBeTruthy();
  });

  it("shows a fractional score to one place and an absent one as a dash", () => {
    expect(fmtScore(12.34)).toBe("12.3");
    expect(fmtScore(12)).toBe("12");
    expect(fmtScore(null)).toBe("-");
    expect(fmtScore(undefined)).toBe("-");
    expect(fmtScore("nonsense")).toBe("-");
  });
});

describe("the placement", () => {
  it("says cleaner than, never a bare percentile", () => {
    // A percentile makes the reader supply the direction, and that ambiguity already shipped once.
    band({ cleanerThanPct: 61.4 });
    expect(screen.getByText("61%")).toBeTruthy();
    expect(screen.getByText(/of passively graded apps/)).toBeTruthy();
  });

  it("names the battery it was compared against", () => {
    band({ cleanerThanPct: 61.4, mode: "active" });
    expect(screen.getByText(/of actively graded apps/)).toBeTruthy();
  });

  it("is absent entirely when there is no placement", () => {
    band({ cleanerThanPct: null });
    expect(screen.queryByText(/cleaner than/)).toBeNull();
  });
});

describe("the checks view", () => {
  it("reads failed of applied of available", () => {
    band();
    const row = document.querySelector('.sample-axis[data-axis="security"]')!;
    expect(within(row as HTMLElement).getByText("4")).toBeTruthy();
    expect(within(row as HTMLElement).getByText("/9")).toBeTruthy();
    expect(within(row as HTMLElement).getByText("/17")).toBeTruthy();
  });

  it("draws all three segments, including what never ran", () => {
    band();
    expect(track("security").querySelectorAll(".seg").length).toBe(3);
    expect(track("security").querySelector(".seg.na")).not.toBeNull();
  });

  it("totals what applied against the whole battery", () => {
    band();
    expect(screen.getByText(/23 of 44 applied/)).toBeTruthy();
  });
});

describe("the points view", () => {
  it("drops the did-not-apply segment, because points have no equivalent", () => {
    // The drift that mattered most: the sample kept drawing three segments and three legend keys in
    // points mode, where the report draws two.
    band();
    fireEvent.click(screen.getByRole("button", { name: "slop points" }));

    expect(track("security").querySelectorAll(".seg").length).toBe(2);
    expect(track("security").querySelector(".seg.na")).toBeNull();
  });

  it("relabels the legend to carried and survived", () => {
    band();
    fireEvent.click(screen.getByRole("button", { name: "slop points" }));

    // The keys are text nodes beside the swatch spans, so read the legend rather than hunt for an
    // element whose whole content is one word.
    const legend = document.querySelector(".sample-legend")!.textContent ?? "";
    expect(legend).toContain("carried");
    expect(legend).toContain("survived");
    expect(legend).not.toContain("did not apply");
  });

  it("reads slop carried against the axis ceiling", () => {
    band();
    fireEvent.click(screen.getByRole("button", { name: "slop points" }));

    const row = document.querySelector('.sample-axis[data-axis="security"]')!;
    expect(within(row as HTMLElement).getByText("20")).toBeTruthy();
    expect(within(row as HTMLElement).getByText("/ 46 pts")).toBeTruthy();
  });

  it("keeps the did-not-apply segment when an axis has no ceiling to scale against", () => {
    // An older grade stored no axis_potential. Without a ceiling the bar cannot be rescaled, so it
    // stays a checks-shaped bar rather than drawing a segment against nothing.
    band({ rows: [{ ...ROWS[0], potential: null }] });
    fireEvent.click(screen.getByRole("button", { name: "slop points" }));

    expect(track("security").querySelectorAll(".seg").length).toBe(3);
  });
});

describe("the toggle", () => {
  it("marks the live view for a screen reader and for the stylesheet", () => {
    band();
    const checks = screen.getByRole("button", { name: "checks" });
    const points = screen.getByRole("button", { name: "slop points" });

    expect(checks.getAttribute("aria-pressed")).toBe("true");
    expect(checks.className).toContain("on");

    fireEvent.click(points);

    expect(points.getAttribute("aria-pressed")).toBe("true");
    expect(points.className).toContain("on");
    expect(checks.className).not.toContain("on");
  });
});

describe("the footer", () => {
  it("renders nothing at all when the caller passes none", () => {
    band();
    expect(document.querySelector(".band-bottom")).toBeNull();
  });

  it("carries whatever the caller puts there", () => {
    band({ footer: <span>a chip</span> });
    expect(within(document.querySelector(".band-bottom") as HTMLElement).getByText("a chip")).toBeTruthy();
  });
});
