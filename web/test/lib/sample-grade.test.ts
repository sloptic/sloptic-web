/** The landing page's sample grade has to be a grade that could actually happen.
 *
 *  It was not. It charged 8 for a shipped dev build the catalog prices at 28, 3 for a slow first
 *  response priced at 26, labelled a 5-point finding "no content security policy" when 5 is a WEAK
 *  policy and a missing one is 8, and gave the performance axis 8 points across two failures when
 *  the cheapest passive performance probe costs 6. None of that is visible by reading it; it needs
 *  the catalog beside it, which is what these assertions are.
 *
 *  The counts are checked against the GENERATED facts, so the day the passive battery changes this
 *  fails here rather than shipping a sample that quietly disagrees with the rest of the site.
 */
import { describe, it, expect } from "vitest";
import { SAMPLE_SCORE, SAMPLE_ROWS, SAMPLE_FINDINGS, SAMPLE_PASSED } from "@/lib/sample-grade";
import { PASSIVE_BY_AREA, TOTALS, type Area } from "@/lib/checks";
import { PASSIVE } from "@/lib/corpus";

const sumBy = (axis: string) =>
  SAMPLE_FINDINGS.filter((f) => f.axis === axis).reduce((n, f) => n + f.penalty, 0);

describe("the sample adds up the way a scored report does", () => {
  it("sums each axis's findings to that axis's slop", () => {
    // "rows sum to their category header and the headers sum to the score" is what the real report
    // promises above its findings list. A sample that does not is teaching the wrong arithmetic.
    for (const row of SAMPLE_ROWS) {
      expect(sumBy(row.id)).toBe(row.slop);
    }
  });

  it("sums the axes to the headline score", () => {
    expect(SAMPLE_ROWS.reduce((n, r) => n + r.slop, 0)).toBe(SAMPLE_SCORE);
  });

  it("shows every finding it counted, so the arithmetic is checkable on screen", () => {
    for (const row of SAMPLE_ROWS) {
      expect(SAMPLE_FINDINGS.filter((f) => f.axis === row.id)).toHaveLength(row.failed);
    }
  });
});

describe("the sample agrees with the battery the site advertises", () => {
  it("uses the real passive count for each axis", () => {
    for (const row of SAMPLE_ROWS) {
      expect(row.possible).toBe(PASSIVE_BY_AREA[row.id as Area]);
    }
  });

  it("totals to the passive battery the rest of the site quotes", () => {
    expect(SAMPLE_ROWS.reduce((n, r) => n + r.possible, 0)).toBe(TOTALS.passive);
  });

  it("never applies more checks than the battery holds, or fails more than applied", () => {
    for (const row of SAMPLE_ROWS) {
      expect(row.applied).toBeLessThanOrEqual(row.possible);
      expect(row.failed).toBeLessThanOrEqual(row.applied);
    }
  });

  it("carries no more slop than the axis ceiling it is drawn against", () => {
    // The points bar draws carried against potential. Carrying more than the ceiling would render a
    // segment wider than its track.
    for (const row of SAMPLE_ROWS) {
      expect(row.potential).not.toBeNull();
      expect(row.slop).toBeLessThanOrEqual(row.potential as number);
    }
  });
});

describe("the sample looks like a real app, not a flattering one", () => {
  it("sits inside the middle half of real passive grades", () => {
    // A sample scoring 3 would be an advertisement, and one scoring 150 would be a warning. The
    // corpus ships its own quartiles, so "typical" is a measured range rather than a number I liked:
    // q1 25, median 39, q3 59.7 across 1,750 apps.
    const d = PASSIVE.distribution as { q1: number; q3: number };
    expect(SAMPLE_SCORE).toBeGreaterThanOrEqual(d.q1);
    expect(SAMPLE_SCORE).toBeLessThanOrEqual(d.q3);
  });

  it("names something that passed, since a report is not only a list of faults", () => {
    expect(SAMPLE_PASSED.length).toBeGreaterThan(0);
  });

  it("gives every finding a penalty above zero", () => {
    for (const f of SAMPLE_FINDINGS) expect(f.penalty).toBeGreaterThan(0);
  });
});
