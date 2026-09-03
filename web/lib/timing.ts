// How long a grade takes, measured rather than guessed.
//
// SOURCE OF TRUTH: sloptic-main validation/grade-timing.json, vendored like the corpus figures
// because a Vercel build cannot see that repo. scripts/check-corpus-drift.sh compares them.
//
// The numbers come from the corpus runs themselves: 1,858 passive grades and 1,782 full ones on the
// same 4 core box the worker runs on, at the same concurrency. That matters more than the averages
// do. `effective_parallelism` is 3.69 on the passive run, not the nominal 4, because four grades
// sharing four cores contend; dividing by 4 would promise a fifth more throughput than exists.

import timing from "./corpus/grade-timing.json";

type Battery = "passive" | "active";

function stats(mode: Battery) {
  const b = mode === "active" ? timing.batteries.full : timing.batteries.passive;
  return { mean: b.seconds.mean, parallel: b.measurement.effective_parallelism };
}

/** Seconds to work through `remaining` grades, on a worker doing nothing else. */
export function estimateSeconds(remaining: number, mode: Battery): number {
  if (remaining <= 0) return 0;
  const { mean, parallel } = stats(mode);
  return (remaining * mean) / parallel;
}

/** A duration in seconds as a phrase, rounded to a precision the estimate can actually support. */
export function formatEta(s: number): string {
  if (s < 90) return "under two minutes";
  const mins = Math.round(s / 60);
  if (mins < 60) return `about ${mins} minutes`;
  const hours = s / 3600;
  if (hours < 1.75) return "about an hour and a half";
  return `about ${Math.round(hours)} hours`;
}

/** The estimate as a phrase, rounded to a precision the estimate can actually support. */
export function estimateLabel(remaining: number, mode: Battery): string {
  return formatEta(estimateSeconds(remaining, mode));
}

/** What one grade of this battery took on the corpus, per grade (not divided by parallelism). The
 *  yardstick the live estimate corrects against. */
export function meanSeconds(mode: Battery): number {
  return stats(mode).mean;
}

/** A live estimate: the corpus precalculation, scaled by how long THIS run's grades are actually
 *  taking. `durations` are measured per-grade seconds (finished - claimed) for grades that have
 *  completed here. A field slower than the corpus stretches the estimate, a faster one shrinks it,
 *  and with no samples yet it is exactly the corpus number. Measured per grade, so the idle gaps a
 *  drip feed leaves between demos never enter it: only time a grade was actually running counts.
 *
 *  The correction is trusted in proportion to how many grades it has seen, reaching full weight at
 *  five, so one unusually slow first app does not swing the whole estimate. */
export function liveEtaSeconds(remaining: number, mode: Battery, durations: number[]): number {
  const base = estimateSeconds(remaining, mode);
  const usable = durations.filter((d) => d > 0);
  if (usable.length === 0) return base;
  const observed = usable.reduce((a, b) => a + b, 0) / usable.length;
  const factor = observed / meanSeconds(mode);
  const w = Math.min(usable.length, 5) / 5;
  return base * (1 * (1 - w) + factor * w);
}

export function liveEtaLabel(remaining: number, mode: Battery, durations: number[]): string {
  if (remaining <= 0) return "";
  return formatEta(liveEtaSeconds(remaining, mode, durations));
}

/** What one grade typically takes, for copy that talks about a single app. */
export function medianSeconds(mode: Battery): number {
  const b = mode === "active" ? timing.batteries.full : timing.batteries.passive;
  return b.seconds.median;
}
