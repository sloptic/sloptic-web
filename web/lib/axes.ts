import {
  AREA_LABELS,
  AREA_ORDER,
  AREAS,
  PASSIVE_BY_AREA,
  describeProbe,
  type Area,
} from "@/lib/checks";
import type { Finding, GradeResult } from "@/lib/types";

/** One axis as the report's band draws it. */
export type AreaRow = {
  id: Area;
  label: string;
  failed: number;
  applied: number;
  possible: number;
  slop: number;
  potential: number | null;
};

/** The axes a grade was SCORED on, and each one's counts, read from the grade itself.
 *
 *  Pulled out of the report so it can be tested, because it is the subtle part of rendering a grade
 *  from a different ruler. Sloptic 3.0 split accessibility out of quality. A grade from before then
 *  has no accessibility axis at all, and drawn against today's four it showed "accessibility 0",
 *  which reads as clean on accessibility while its accessibility slop was inside quality the whole
 *  time. So the axes come from the grade: its ruler stamp says which set it was scored on, and its
 *  own coverage says what each axis's battery was when it ran.
 *
 *  `axisOf` maps an area from today's probe index onto this grade's axes, for anything else on the
 *  page that groups by area (the passed list does).
 */
export function axisView(r: GradeResult): {
  rows: AreaRow[];
  order: Area[];
  axisOf: (area: string) => string;
  pre3: boolean;
} {
  const findings: Finding[] = r.findings ?? [];
  const appliedIds: string[] = (r.coverage?.applied as string[] | undefined) ?? [];

  // WHICH axes this grade was scored on, and what each axis's battery was, come from the RECORD,
  // not from today's catalog. Sloptic 3.0 split accessibility out of quality, so a grade scored
  // before then has no accessibility subtotal because the axis did not exist, and its accessibility
  // slop sits inside quality. Rendered against the 3.0 axes it showed "accessibility 0", which reads
  // as clean on accessibility, and its a11y checks were counted under an axis the grade never had.
  //
  // The stamp decides, not the axis_slop keys: the grader omits an axis with nothing wrong, so a 3.0
  // grade that is clean on accessibility has no key either, and that one IS a clean zero.
  const pre3 = !r.ruler;
  const axisOf = (area: string): string => (pre3 && area === "accessibility" ? "qa" : area);
  const order: Area[] = pre3 ? AREA_ORDER.filter((a) => a !== "accessibility") : AREA_ORDER;

  // How many PROBES found something, not how many findings there were. One probe firing on eight
  // paths is eight findings and one failed check, and counting findings made "failed" exceed
  // "applied": a security axis read 51 of 15, and the passed segment took a negative width.
  const failedProbes: Record<string, Set<string>> = {};
  for (const f of findings) {
    (failedProbes[axisOf(f.bundle)] ??= new Set()).add(f.probe_id);
  }
  const failedBy: Record<string, number> = {};
  for (const [bundle, ids] of Object.entries(failedProbes)) failedBy[bundle] = ids.size;

  // The record's own coverage files every category under the axis the grader used AT THE TIME, with
  // how many of its probes ran and how many were n/a. Per axis that is exactly the battery the grade
  // ran (a 2.x passive grade sums to its 44, a 3.0 one to 45), which is right for any ruler and
  // needs nothing from the current catalog.
  type Kind = { ran?: number; na?: number; bundle?: string };
  const ranBy: Record<string, number> = {};
  const batteryBy: Record<string, number> = {};
  for (const k of Object.values((r.coverage?.by_kind ?? {}) as Record<string, Kind>)) {
    if (!k?.bundle) continue;
    const a = axisOf(k.bundle);
    ranBy[a] = (ranBy[a] ?? 0) + (k.ran ?? 0);
    batteryBy[a] = (batteryBy[a] ?? 0) + (k.ran ?? 0) + (k.na ?? 0);
  }

  // Fallbacks for a record stored before coverage carried by_kind: the probe index, folded the same
  // way, and the catalog's own counts.
  const appliedBy: Record<string, number> = {};
  for (const id of appliedIds) {
    const d = describeProbe(id);
    if (d) {
      const a = axisOf(d.area);
      appliedBy[a] = (appliedBy[a] ?? 0) + 1;
    }
  }
  const catalogBattery = (id: Area): number => {
    const count = (a: Area) =>
      (r.mode ?? "passive") === "active" ? AREAS.find((x) => x.id === a)?.probes ?? 0 : PASSIVE_BY_AREA[a] ?? 0;
    return pre3 && id === "qa" ? count("qa") + count("accessibility") : count(id);
  };

  const rows: AreaRow[] = order.map((id) => ({
    id,
    // Before 3.0, quality WAS accessibility and quality, and a grade from then is labelled as what it
    // measured, not as what the word means today.
    label: pre3 && id === "qa" ? "accessibility & quality" : AREA_LABELS[id],
    failed: failedBy[id] ?? 0,
    applied: id in batteryBy ? ranBy[id] ?? 0 : appliedBy[id] ?? 0,
    // The denominator is the battery that ran, so an active grade counts the full battery and a
    // passive one the floor. PASSIVE_BY_AREA alone once made every active report claim the passive
    // battery and show more applied than available.
    possible: id in batteryBy ? batteryBy[id] : catalogBattery(id),
    // an axis with nothing wrong is absent from axis_slop entirely, not zero
    slop: r.axis_slop?.[id as keyof typeof r.axis_slop] ?? 0,
    // what the axis would have cost if every applicable check had fired; the slop view's ceiling
    potential: r.axis_potential?.[id as keyof typeof r.axis_potential] ?? null,
  }));

  return { rows, order, axisOf, pre3 };
}
