import { describe, it, expect } from "vitest";
import { provisionalCleanerThan } from "@/lib/corpus";

describe("provisionalCleanerThan", () => {
  it("places the corpus median at the middle", () => {
    // The strongest check available: the passive median is 39.0 in the shipped figures, so a grade
    // sitting exactly there must be cleaner than about half the population. If the bin walk is
    // inverted or off by a bin, this is where it shows.
    expect(provisionalCleanerThan(39.0, "passive")).toBeGreaterThanOrEqual(48);
    expect(provisionalCleanerThan(39.0, "passive")).toBeLessThanOrEqual(52);
  });

  it("puts a clean app above nearly everyone and a wreck below nearly everyone", () => {
    expect(provisionalCleanerThan(0, "passive")).toBeGreaterThanOrEqual(99);
    expect(provisionalCleanerThan(500, "passive")).toBe(0);
  });

  it("never climbs as slop climbs", () => {
    // Slop only ever goes up during a grade, so the placement may only go down. A rise would mean
    // the number improves as the app gets worse, which is the one thing this must not do.
    let last = 101;
    for (let s = 0; s <= 200; s += 2.5) {
      const p = provisionalCleanerThan(s, "passive")!;
      expect(p).toBeLessThanOrEqual(last);
      last = p;
    }
  });

  it("moves within a bin rather than snapping to its edge", () => {
    // Otherwise every score in a ten point band reports the same percentile and the number sits
    // still while the grade moves, which reads as broken.
    expect(provisionalCleanerThan(21, "passive")).not.toBe(provisionalCleanerThan(29, "passive"));
  });

  it("reads the curve for the battery it was asked about", () => {
    // Two frozen curves that must never be mixed (CLAUDE.md). The medians differ, 39.0 and 50.0, so
    // the same score cannot place the same way in both.
    expect(provisionalCleanerThan(50, "passive")).not.toBe(provisionalCleanerThan(50, "active"));
  });
});
