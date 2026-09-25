/** axisView: the axes a grade was SCORED on, read from the grade.
 *
 *  Sloptic 3.0 split accessibility out of quality. A grade from before then has no accessibility axis
 *  at all, so drawn against today's four axes it showed "accessibility 0", which reads as clean on
 *  accessibility while its accessibility slop was inside quality the whole time. These records are
 *  shaped like the real ones: the 2.x fixture's coverage mirrors a stored production grade, whose
 *  by_kind sums per axis to quality 15, security 17, performance 12 = 44.
 */
import { describe, it, expect } from "vitest";
import { axisView } from "@/lib/axes";
import { PASSIVE_BY_AREA } from "@/lib/checks";
import type { GradeResult } from "@/lib/types";

type Kind = { ran: number; na: number; bundle: string };

/** by_kind with `n` probes on an axis, `ran` of them applied, spread over one category. */
function kinds(spec: Record<string, [number, number]>): Record<string, Kind> {
  const out: Record<string, Kind> = {};
  for (const [bundle, [ran, na]] of Object.entries(spec)) out[`${bundle}-kind`] = { ran, na, bundle };
  return out;
}

function grade(over: Partial<GradeResult> & { by_kind?: Record<string, Kind> }): GradeResult {
  const { by_kind, ...rest } = over;
  return {
    mode: "passive",
    slop_score: 0,
    axis_slop: {},
    findings: [],
    coverage: by_kind ? { by_kind, applied: [] } : { applied: [] },
    ...rest,
  } as unknown as GradeResult;
}

const RULER_3 = { full: "2026.4", passive: "passive-2026.2" };

describe("a 3.0 grade", () => {
  const r = grade({
    ruler: RULER_3,
    axis_slop: { security: 10.5, qa: 10, accessibility: 20, performance: 8 },
    by_kind: kinds({ security: [16, 1], qa: [13, 0], accessibility: [3, 0], performance: [11, 1] }),
  });

  it("shows the four axes it was scored on, in the grader's order", () => {
    expect(axisView(r).rows.map((x) => x.id)).toEqual(["security", "qa", "accessibility", "performance"]);
  });

  it("takes each axis's battery from the record, which sums to the battery that ran", () => {
    const rows = axisView(r).rows;
    expect(rows.map((x) => x.possible)).toEqual([17, 13, 3, 12]);
    expect(rows.reduce((n, x) => n + x.possible, 0)).toBe(45);
    expect(rows.map((x) => x.applied)).toEqual([16, 13, 3, 11]);
  });

  it("labels quality as quality, since accessibility reports on its own", () => {
    expect(axisView(r).rows.find((x) => x.id === "qa")?.label).toBe("quality");
  });

  it("shows a clean accessibility axis as a real zero", () => {
    // The grader OMITS an axis with nothing wrong. On a 3.0 grade a missing key is a clean axis, and
    // that is why the stamp, not the key, decides whether the axis exists.
    const clean = grade({
      ruler: RULER_3,
      axis_slop: { security: 3 },
      by_kind: kinds({ security: [16, 1], qa: [13, 0], accessibility: [3, 0], performance: [11, 1] }),
    });
    const a11y = axisView(clean).rows.find((x) => x.id === "accessibility");
    expect(a11y).toBeDefined();
    expect(a11y?.slop).toBe(0);
    expect(a11y?.applied).toBe(3);
  });

  it("counts a failed accessibility check under accessibility", () => {
    const r2 = grade({
      ruler: RULER_3,
      findings: [{ probe_id: "qa-a11y-001", bundle: "accessibility", category: "accessibility" }] as never,
      by_kind: kinds({ security: [16, 1], qa: [13, 0], accessibility: [3, 0], performance: [11, 1] }),
    });
    const rows = axisView(r2).rows;
    expect(rows.find((x) => x.id === "accessibility")?.failed).toBe(1);
    expect(rows.find((x) => x.id === "qa")?.failed).toBe(0);
  });
});

describe("a grade from before 3.0", () => {
  // No stamp, three axes, accessibility filed under quality: exactly what 2.x wrote.
  const r = grade({
    ruler: null,
    axis_slop: { security: 13, qa: 20, performance: 8 },
    findings: [{ probe_id: "qa-a11y-001", bundle: "qa", category: "accessibility" }] as never,
    by_kind: kinds({ security: [11, 6], qa: [9, 6], performance: [7, 5] }),
  });

  it("shows the three axes it was scored on, not accessibility 0", () => {
    const ids = axisView(r).rows.map((x) => x.id);
    expect(ids).toEqual(["security", "qa", "performance"]);
    expect(ids).not.toContain("accessibility");
  });

  it("labels quality as what it measured then", () => {
    expect(axisView(r).rows.find((x) => x.id === "qa")?.label).toBe("accessibility & quality");
  });

  it("keeps the battery it actually ran, 44, rather than today's 45", () => {
    const rows = axisView(r).rows;
    expect(rows.reduce((n, x) => n + x.possible, 0)).toBe(44);
    expect(rows.find((x) => x.id === "qa")?.possible).toBe(15);
  });

  it("counts its accessibility finding in quality, where 2.x scored it", () => {
    expect(axisView(r).rows.find((x) => x.id === "qa")?.failed).toBe(1);
  });

  it("folds today's accessibility area back into quality for anything else on the page", () => {
    const { axisOf } = axisView(r);
    expect(axisOf("accessibility")).toBe("qa");
    expect(axisOf("security")).toBe("security");
  });
});

describe("a record stored before coverage carried by_kind", () => {
  it("falls back to the catalog's counts, folded for a pre-3.0 grade", () => {
    const r = grade({ ruler: null, axis_slop: { qa: 5 } });
    const qa = axisView(r).rows.find((x) => x.id === "qa");
    expect(qa?.possible).toBe(PASSIVE_BY_AREA.qa + PASSIVE_BY_AREA.accessibility);
  });

  it("uses today's per-axis counts for a 3.0 grade", () => {
    const r = grade({ ruler: RULER_3, axis_slop: {} });
    const rows = axisView(r).rows;
    expect(rows.find((x) => x.id === "accessibility")?.possible).toBe(PASSIVE_BY_AREA.accessibility);
  });

  it("maps nothing when the grade is on the current ruler", () => {
    expect(axisView(grade({ ruler: RULER_3 })).axisOf("accessibility")).toBe("accessibility");
  });
});
