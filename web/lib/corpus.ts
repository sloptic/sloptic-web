// The corpus study figures, vendored.
//
// SOURCE OF TRUTH: sloptic-main validation/corpus-figures-active.json
//                  sloptic-main validation/corpus-figures-passive.json
// These are COPIES, because a Vercel build cannot see sloptic-main. They go stale the moment the
// corpus is regraded, so `scripts/check-corpus-drift.sh` compares them against the grader's committed
// files; run it before publishing anything that cites these numbers. Never hand-edit a figure here:
// the whole point is that the site and the study quote one artifact.
//
// Both files are aggregate only by construction. No app names, URLs, hosts, keys, or per-app rows,
// so nothing here can identify a team whose app was graded without their asking.

import active from "./corpus/corpus-figures-active.json";
import passive from "./corpus/corpus-figures-passive.json";

export const ACTIVE = active;
export const PASSIVE = passive;

/** Three honesty rails the grader baked into the data. Breaking one turns a true figure into a false
 *  impression, which is the failure mode this whole page exists to argue against. */

/** Events include some with a single app. An n=1 median is not a comparison. */
export const MIN_EVENT_N = 8;

/** Canvas-shell platforms (Streamlit and the like) were graded as the framework, not the app, so
 *  their score describes the host. Shown as excluded, NEVER as a median of 0, which would read as
 *  "flawless" when it means "not measurable". */
export const EXCLUDED_STACKS = active.by_stack_excluded;

/** The managed backend finding is ACTIVE ONLY: the passive file reports 0 apps because the anonymous
 *  tier never runs the probe that finds it, not because the exposure is absent. Quote it from the
 *  active file, and never on a page describing what a passive grade sees. */
export const STAR_FINDING_IS_ACTIVE_ONLY = true;

export type EventRow = (typeof active.by_event)[number];
export type StackRow = (typeof active.by_stack)[number];
export type Bin = [number, number, number];

/** Events large enough to compare, worst first. */
export function comparableEvents(min = MIN_EVENT_N): EventRow[] {
  return active.by_event.filter((e) => e.n >= min).sort((a, b) => b.median - a.median);
}

export function fmt(n: number, digits = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}


/** Where a score in progress would place, from the histogram this module already ships.
 *
 *  PROVISIONAL, and precisely so. A real placement goes through the grader's benchmark.rank() with
 *  the whole record, which tiebreaks on catastrophe, worst finding, exposure and categories applied;
 *  a bare number reaches none of that. This is the shape of the distribution, not a ranking, and the
 *  UI that shows it says as much.
 *
 *  Interpolates WITHIN the bin rather than snapping to its edge: otherwise every score in a ten
 *  point band reports the same percentile, and the number sits still while the grade moves.
 */
export function provisionalCleanerThan(slop: number, mode: "passive" | "active"): number | null {
  const dist = (mode === "active" ? ACTIVE : PASSIVE).distribution;
  const bins = dist?.bins as Bin[] | undefined;
  if (!bins?.length || !dist.n) return null;

  let worse = 0; // apps carrying MORE slop, which is what "cleaner than" counts
  for (const [lo, hi, count] of bins) {
    if (slop >= hi) continue;
    if (slop < lo) {
      worse += count;
      continue;
    }
    const span = hi - lo;
    worse += span > 0 ? count * ((hi - slop) / span) : count;
  }
  return Math.max(0, Math.min(100, Math.round((worse / dist.n) * 100)));
}
