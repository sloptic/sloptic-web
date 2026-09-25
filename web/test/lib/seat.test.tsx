/** The builder's seat copy, and the accuracy rails the 3.0 handoff set on it.
 *
 *  These lines will be rewritten, and a rewrite is exactly when a rail gets broken without anyone
 *  noticing. Each one is a claim Sloptic would be wrong to make: that it tests on a real phone (it
 *  simulates one on the grading box), that it checks colorblindness (axe's contrast rule measures
 *  lightness contrast), or that anything but performance is measured on the phone profile.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AXIS_SEAT, SEAT_HREF, SEAT_ROWS, LIGHTHOUSE_PROFILE } from "@/lib/seat";
import ScoreBand from "@/app/ScoreBand";

const ALL_COPY = [...Object.values(AXIS_SEAT), ...SEAT_ROWS.flatMap((r) => [r.failure, r.invisible, r.instead])];

describe("where the seat lines go", () => {
  it("is under performance and accessibility only, where a grade most surprises its team", () => {
    expect(Object.keys(AXIS_SEAT).sort()).toEqual(["accessibility", "performance"]);
  });

  it("links to the explainer", () => {
    expect(SEAT_HREF).toBe("/methodology#your-seat");
  });
});

describe("the accuracy rails", () => {
  it("never says Sloptic tests on a real phone", () => {
    // Lighthouse simulates the phone: it measures on the grading box and scales CPU time by four.
    for (const line of ALL_COPY) expect(line).not.toMatch(/real phone|on a phone|tested on/i);
  });

  it("never claims to test or simulate colorblindness", () => {
    for (const line of ALL_COPY) expect(line).not.toMatch(/colou?r ?blind/i);
  });

  it("keeps the phone framing to performance", () => {
    expect(AXIS_SEAT.accessibility).not.toMatch(/phone|4G|mobile/i);
    expect(AXIS_SEAT.performance).toMatch(/phone/);
  });

  it("writes without em dashes, as the house style requires", () => {
    for (const line of ALL_COPY) expect(line).not.toContain("\u2014");
  });

  it("carries the Lighthouse mobile profile the grader runs", () => {
    // Transcribed, so pinned here: when the grader moves Lighthouse these need rechecking.
    expect(LIGHTHOUSE_PROFILE).toMatchObject({ rttMs: 150, downMbps: 1.6, cpuSlowdown: 4 });
  });
});

describe("the report's band", () => {
  const rows = [
    { id: "security", label: "security", failed: 1, applied: 16, possible: 17, slop: 8, potential: 200 },
    { id: "accessibility", label: "accessibility", failed: 1, applied: 3, possible: 3, slop: 20, potential: 40 },
    { id: "performance", label: "performance", failed: 1, applied: 11, possible: 12, slop: 8, potential: 200 },
  ];

  it("shows the seat line under performance and accessibility, without a click", () => {
    render(<ScoreBand score={36} cleanerThanPct={50} mode="passive" rows={rows} referenceMark={false} footer={null} />);
    expect(screen.getByText(/mid range phone on slow 4G/)).toBeInTheDocument();
    expect(screen.getByText(/screen reader user meets your app/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Why?" })).toHaveLength(2);
  });
});
