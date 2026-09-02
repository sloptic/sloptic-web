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

/** The estimate as a phrase, rounded to a precision the estimate can actually support. */
export function estimateLabel(remaining: number, mode: Battery): string {
  const s = estimateSeconds(remaining, mode);
  if (s < 90) return "under two minutes";
  const mins = Math.round(s / 60);
  if (mins < 60) return `about ${mins} minutes`;
  const hours = s / 3600;
  if (hours < 1.75) return "about an hour and a half";
  return `about ${Math.round(hours)} hours`;
}

/** What one grade typically takes, for copy that talks about a single app. */
export function medianSeconds(mode: Battery): number {
  const b = mode === "active" ? timing.batteries.full : timing.batteries.passive;
  return b.seconds.median;
}
