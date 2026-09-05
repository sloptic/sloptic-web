import { describe, it, expect } from "vitest";
import {
  estimateLabel,
  estimateSeconds,
  formatEta,
  liveEtaLabel,
  liveEtaSeconds,
  meanSeconds,
  medianSeconds,
} from "@/lib/timing";
import timing from "@/lib/corpus/grade-timing.json";

// The corpus measured two batteries and named them "passive" and "full". The product's two modes are
// "passive" and "active", so the mapping is the one place a wrong lookup would quote a 44-probe
// timing for a 102-probe grade.
describe("which battery a mode is timed against", () => {
  it("times an active grade against the full battery, not the passive one", () => {
    expect(meanSeconds("active")).toBe(timing.batteries.full.seconds.mean);
    expect(medianSeconds("active")).toBe(timing.batteries.full.seconds.median);
  });

  it("times a passive grade against the passive battery", () => {
    expect(meanSeconds("passive")).toBe(timing.batteries.passive.seconds.mean);
    expect(medianSeconds("passive")).toBe(timing.batteries.passive.seconds.median);
  });

  it("expects the smaller battery to be the faster one", () => {
    expect(meanSeconds("passive")).toBeLessThan(meanSeconds("active"));
    expect(estimateSeconds(50, "passive")).toBeLessThan(estimateSeconds(50, "active"));
  });
});

describe("estimateSeconds", () => {
  it("is zero when there is nothing left to grade", () => {
    expect(estimateSeconds(0, "passive")).toBe(0);
    expect(estimateSeconds(-3, "active")).toBe(0);
  });

  it("divides by the parallelism that was measured, not the nominal concurrency", () => {
    // Four grades sharing four cores contend, so the run only reached 3.69x. Dividing by 4 would
    // promise a fifth more throughput than exists.
    const measured = timing.batteries.passive.measurement.effective_parallelism;
    expect(measured).toBeLessThan(timing.batteries.passive.measurement.concurrency);
    expect(estimateSeconds(100, "passive")).toBeCloseTo((100 * meanSeconds("passive")) / measured, 6);
    expect(estimateSeconds(100, "passive")).toBeGreaterThan((100 * meanSeconds("passive")) / 4);
  });

  it("scales with the size of the field", () => {
    expect(estimateSeconds(20, "active")).toBeCloseTo(2 * estimateSeconds(10, "active"), 6);
  });

  // DISCREPANCY (reported, not fixed). lib/timing.ts:24 divides by parallelism unconditionally, so
  // the last grade in a run is estimated at a quarter of what one grade takes. A field of one is a
  // real case (the board polls until the last entry lands), and "under two minutes" for a passive
  // grade whose corpus median is 94 seconds and whose mean is 121.7 is a promise the worker cannot
  // keep. Below the concurrency the floor is one grade's own duration.
  it.fails("never estimates one remaining grade at less than one grade takes", () => {
    expect(estimateSeconds(1, "passive")).toBeGreaterThanOrEqual(medianSeconds("passive"));
    expect(estimateSeconds(1, "active")).toBeGreaterThanOrEqual(medianSeconds("active"));
  });
});

describe("formatEta", () => {
  it("does not put a number on a wait shorter than two minutes", () => {
    expect(formatEta(0)).toBe("under two minutes");
    expect(formatEta(89)).toBe("under two minutes");
  });

  it("counts in minutes up to an hour", () => {
    expect(formatEta(90)).toBe("about 2 minutes");
    expect(formatEta(600)).toBe("about 10 minutes");
    expect(formatEta(3540)).toBe("about 59 minutes");
  });

  it("counts in hours once the wait is long enough that minutes are false precision", () => {
    expect(formatEta(6300)).toBe("about 2 hours");
    expect(formatEta(4 * 3600)).toBe("about 4 hours");
  });

  it("keeps the phrase free of em dashes, as the house style requires", () => {
    for (const s of [0, 90, 600, 4000, 6300, 20000]) expect(formatEta(s)).not.toMatch(/[—–]/);
  });

  // DISCREPANCY (reported, not fixed). lib/timing.ts:30-33: 60 rounded minutes falls out of the
  // minutes branch and into the "hour and a half" one, so an estimate of exactly one hour, and every
  // estimate from 59.5 minutes upward, is quoted half an hour longer than it is. The phrase is meant
  // for the 1.25 to 1.75 hour range it cannot express in whole hours.
  it.fails("calls one hour an hour, not an hour and a half", () => {
    expect(formatEta(3600)).not.toBe("about an hour and a half");
    expect(formatEta(3570)).not.toBe("about an hour and a half");
  });

  it("still uses the phrase for the range it exists for", () => {
    expect(formatEta(5400)).toBe("about an hour and a half");
    expect(formatEta(4800)).toBe("about an hour and a half");
  });
});

describe("liveEtaSeconds", () => {
  const base = (n: number) => estimateSeconds(n, "passive");

  it("is exactly the corpus estimate before this run has finished anything", () => {
    expect(liveEtaSeconds(10, "passive", [])).toBe(base(10));
  });

  it("ignores durations that cannot be real, so a skewed clock cannot move the estimate", () => {
    // finished_at before claimed_at gives a negative, and a zero is a grade that never ran.
    expect(liveEtaSeconds(10, "passive", [0, -5])).toBe(base(10));
  });

  it("stretches the estimate for a field slower than the corpus", () => {
    const slow = Array(5).fill(meanSeconds("passive") * 2);
    expect(liveEtaSeconds(10, "passive", slow)).toBeCloseTo(base(10) * 2, 6);
  });

  it("shrinks the estimate for a field faster than the corpus", () => {
    const fast = Array(5).fill(meanSeconds("passive") / 2);
    expect(liveEtaSeconds(10, "passive", fast)).toBeCloseTo(base(10) / 2, 6);
  });

  it("trusts one sample only a fifth as far, so a slow first app cannot swing the estimate", () => {
    const one = liveEtaSeconds(10, "passive", [meanSeconds("passive") * 3]);
    // Weight 1/5 on a factor of 3: 0.8 + 0.6 = 1.4, not the full 3.
    expect(one).toBeCloseTo(base(10) * 1.4, 6);
    expect(one).toBeLessThan(base(10) * 3);
  });

  it("reaches full weight at five samples and does not keep growing past them", () => {
    const factorAtFive = Array(5).fill(meanSeconds("passive") * 2);
    const factorAtTwenty = Array(20).fill(meanSeconds("passive") * 2);
    expect(liveEtaSeconds(10, "passive", factorAtTwenty)).toBeCloseTo(
      liveEtaSeconds(10, "passive", factorAtFive),
      6
    );
  });

  it("averages the samples rather than following the last one", () => {
    const m = meanSeconds("passive");
    const mixed = [m * 0.5, m * 1.5, m, m, m];
    expect(liveEtaSeconds(10, "passive", mixed)).toBeCloseTo(base(10), 6);
  });

  it("stays at zero when there is nothing left, however slow the field was", () => {
    expect(liveEtaSeconds(0, "passive", [10_000])).toBe(0);
  });
});

describe("liveEtaLabel", () => {
  it("says nothing at all when there is nothing left to wait for", () => {
    // The caller concatenates onto this, so an empty string is what keeps a finished run from
    // claiming a wait.
    expect(liveEtaLabel(0, "passive", [])).toBe("");
    expect(liveEtaLabel(-1, "active", [200])).toBe("");
  });

  it("phrases the live estimate the same way the corpus one is phrased", () => {
    expect(liveEtaLabel(40, "passive", [])).toBe(estimateLabel(40, "passive"));
  });

  it("reports a longer wait once the field proves slower than the corpus", () => {
    const slow = Array(5).fill(meanSeconds("active") * 3);
    expect(liveEtaLabel(40, "active", slow)).not.toBe(estimateLabel(40, "active"));
    expect(liveEtaSeconds(40, "active", slow)).toBeGreaterThan(estimateSeconds(40, "active"));
  });
});
