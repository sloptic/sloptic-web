import { describe, it, expect } from "vitest";
import {
  cleanIds,
  failureText,
  isLimitedEngagement,
  MAX_IDS,
  ordinal,
  recoveryMarks,
  SUMMARY_SELECT,
  toSummary,
} from "@/lib/grades";

// The prefixes tested here are the ones the worker actually writes: grade_child.py (target not
// gradeable, worker error), __main__.py (the kill and the deadline). If the worker's wording moves,
// these are the tests that should notice, since the whole point of the function is to intercept
// operator prose before a stranger reads it.
describe("failureText", () => {
  it("says something rather than nothing when the worker recorded no reason", () => {
    expect(failureText(null)).toBe("The grade did not finish.");
    expect(failureText(undefined)).toBe("The grade did not finish.");
    expect(failureText("")).toBe("The grade did not finish.");
    // Whitespace is the same absence wearing a different coat.
    expect(failureText("   \n ")).toBe("The grade did not finish.");
  });

  it("turns an unreachable target into instructions the submitter can act on", () => {
    const out = failureText("target not gradeable: connection refused to https://x.example");
    expect(out).toBe(
      "Sloptic could not reach the app. Check that the URL is live, public, and serving over HTTPS."
    );
    // The operator detail, including the address and the transport error, must not survive.
    expect(out).not.toContain("connection refused");
  });

  it("never leaks a worker stack detail to the person who submitted the grade", () => {
    const out = failureText("worker error: KeyError('surface')");
    expect(out).toBe(
      "Something went wrong on our side, so this grade did not finish. Grading it again usually works."
    );
    expect(out).not.toContain("KeyError");
  });

  it("explains a killed grader without naming the signal", () => {
    const out = failureText("the grader process was killed (signal 9)");
    expect(out).toBe("The grade stopped before it finished. Grading it again usually works.");
    expect(out).not.toContain("signal");
  });

  it("keeps the deadline the worker measured, as a sentence", () => {
    expect(failureText("grading did not finish within 15 minutes and was stopped")).toBe(
      "Grading did not finish within 15 minutes and was stopped. Very large apps can exceed the time one grade gets."
    );
  });

  it("passes through a message that was already written to be read", () => {
    // The active-authorization refusal and the queue-window sweep both write for the visitor, so
    // rewording them here would only lose the reason.
    const refusal = "not authorized to grade actively: no live grant for this origin";
    expect(failureText(refusal)).toBe(refusal);
    const queue = "not started within the queue window: no worker was available to run it";
    expect(failureText(queue)).toBe(queue);
  });

  it("trims before matching, so a stray newline does not defeat a prefix", () => {
    expect(failureText("  worker error: boom\n")).toBe(
      "Something went wrong on our side, so this grade did not finish. Grading it again usually works."
    );
  });

  it("writes without em dashes, as the house style requires", () => {
    const outputs = [
      failureText(null),
      failureText("target not gradeable: x"),
      failureText("worker error: x"),
      failureText("the grader process was killed (signal 9)"),
      failureText("grading did not finish within 15 minutes and was stopped"),
    ];
    for (const s of outputs) expect(s).not.toMatch(/[—–]/);
  });

  // The worker writes that refusal for an operator, naming an env var, an nftables file and a doc
    // path. Operator prose is exactly what this function exists to intercept.
  it("does not hand the egress-sandbox refusal to a visitor verbatim", () => {
    const out = failureText(
      "egress sandbox not declared ready on this host: refusing to grade a real target. " +
        "The code tiers ship with the grader; set EGRESS_SANDBOX_READY=1 only once the OS tier " +
        "(worker/deploy/egress.nft) is loaded AND the self-test in docs/egress-plan.md passes."
    );
    expect(out).not.toContain("EGRESS_SANDBOX_READY");
    expect(out).not.toContain("worker/deploy");
  });
});

describe("toSummary", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: "g1",
    origin: "https://app.example",
    submitted_url: "https://app.example/",
    mode: "passive",
    status: "done",
    submitted_at: "2026-09-01T00:00:00Z",
    finished_at: "2026-09-01T00:02:00Z",
    account_id: null,
    ...extra,
  });

  it("reads an embedded result whether PostgREST sends an object or a one-element array", () => {
    const asArray = toSummary(row({ results: [{ slop_score: 42, percentile: 19 }] }));
    const asObject = toSummary(row({ results: { slop_score: 42, percentile: 19 } }));
    expect(asArray.slop_score).toBe(42);
    expect(asObject).toEqual(asArray);
  });

  it("reports no score for a grade whose report the retention sweep already deleted", () => {
    // expire_anonymous_reports (migration 0009) drops the results row and keeps the grade, so this
    // shape is the ordinary end state of every unclaimed grade, not an edge case.
    const s = toSummary(row({ results: [] }));
    expect(s.slop_score).toBeNull();
    expect(s.percentile).toBeNull();
    expect(s.cleaner_than_pct).toBeNull();
    expect(s.percentile_band).toBeNull();
    expect(s.status).toBe("done");
  });

  it("reports no score when the row carries no results key at all", () => {
    const s = toSummary(row());
    expect(s.slop_score).toBeNull();
    expect(s.cleaner_than_pct).toBeNull();
  });

  it("keeps a slop of zero as zero, since zero means nothing was found", () => {
    // The score is deduction only, so 0 is the best possible result and must never read as absent.
    const s = toSummary(row({ results: [{ slop_score: 0, percentile: 0 }] }));
    expect(s.slop_score).toBe(0);
    expect(s.percentile).toBe(0);
  });

  it("keeps the fractional score the grader stored", () => {
    // Migration 0008 made slop_score decimal precisely because truncating moves an app to the floor
    // of its integer bucket on the curve.
    expect(toSummary(row({ results: [{ slop_score: "12.5" }] })).slop_score).toBe(12.5);
  });

  it("prefers the stored ranking over the complement, so the list and the report cannot drift", () => {
    // percentile and cleaner_than_pct do not sum to 100 in the grader: a tie group counts toward
    // neither share, so deriving one from the other would disagree with the report page.
    const s = toSummary(
      row({ results: [{ percentile: 19, ranking: { cleaner_than_pct: 74 } }] })
    );
    expect(s.percentile).toBe(19);
    expect(s.cleaner_than_pct).toBe(74);
  });

  it("falls back to the complement only for a row written before ranking was stored", () => {
    expect(toSummary(row({ results: [{ percentile: 19 }] })).cleaner_than_pct).toBe(81);
    expect(toSummary(row({ results: [{ percentile: 19, ranking: {} }] })).cleaner_than_pct).toBe(81);
    expect(
      toSummary(row({ results: [{ percentile: 19, ranking: { cleaner_than_pct: null } }] }))
        .cleaner_than_pct
    ).toBe(81);
  });

  it("keeps a stored cleaner_than_pct of zero rather than treating it as missing", () => {
    // The worst app in the population is cleaner than nobody, and 0 there is a measurement.
    const s = toSummary(row({ results: [{ percentile: 99, ranking: { cleaner_than_pct: 0 } }] }));
    expect(s.cleaner_than_pct).toBe(0);
  });

  it("reports no percentile when the grader declined to place the grade", () => {
    // rank() refuses a challenge-cut or mode-mismatched record, and the column stays null.
    const s = toSummary(row({ results: [{ slop_score: 7, percentile: null, ranking: null }] }));
    expect(s.percentile).toBeNull();
    expect(s.cleaner_than_pct).toBeNull();
    expect(s.slop_score).toBe(7);
  });

  it("marks a grade claimed only when an account owns it", () => {
    expect(toSummary(row({ account_id: "acct-1" })).claimed).toBe(true);
    expect(toSummary(row({ account_id: null })).claimed).toBe(false);
    // ON DELETE SET NULL (migration 0009): a deleted account's grades revert to anonymous, and the
    // retention sweep reaches them again.
    expect(toSummary(row({ account_id: undefined })).claimed).toBe(false);
  });

  it("never carries the owning account id into the summary", () => {
    // Who owns a grade is nobody else's business, and the report URL is a bearer token.
    const s = toSummary(row({ account_id: "acct-1" })) as Record<string, unknown>;
    expect(Object.keys(s)).not.toContain("account_id");
    expect(JSON.stringify(s)).not.toContain("acct-1");
  });

  it("defaults an unspecified battery to passive, the weaker claim", () => {
    // Mislabelling a passive grade as active would put it on the wrong frozen curve, so the default
    // has to fall to the mode that promises less.
    expect(toSummary(row({ mode: undefined })).mode).toBe("passive");
    expect(toSummary(row({ mode: "active" })).mode).toBe("active");
  });

  it("keeps a running grade with no finish time", () => {
    const s = toSummary(row({ status: "running", finished_at: null, results: [] }));
    expect(s.status).toBe("running");
    expect(s.finished_at).toBeNull();
  });

  it("selects the ranking fields the summary actually reads", () => {
    // The list renders from this select alone, so a field dropped here blanks a column silently.
    for (const col of ["slop_score", "percentile", "percentile_band", "ranking"]) {
      expect(SUMMARY_SELECT).toContain(col);
    }
    // mode rides along because the two batteries rank on different curves and a list that hides
    // which one ran invites comparing numbers that are not comparable.
    expect(SUMMARY_SELECT).toContain("mode");
  });
});

describe("cleanIds", () => {
  const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

  it("returns nothing for anything that is not a list", () => {
    expect(cleanIds(null)).toEqual([]);
    expect(cleanIds(undefined)).toEqual([]);
    expect(cleanIds("not-a-list")).toEqual([]);
    expect(cleanIds({ 0: uuid(1) })).toEqual([]);
    expect(cleanIds([])).toEqual([]);
  });

  it("drops a malformed id rather than failing the whole batch", () => {
    // One corrupt entry in a browser's history should not blank the list it belongs to.
    expect(cleanIds([uuid(1), "nope", "", null, 7, uuid(2)])).toEqual([uuid(1), uuid(2)]);
  });

  it("rejects ids that only look like uuids", () => {
    expect(cleanIds(["00000001-0000-4000-8000-00000000000"])).toEqual([]);
    expect(cleanIds(["00000001-0000-4000-8000-0000000000000"])).toEqual([]);
    expect(cleanIds(["0000000g-0000-4000-8000-000000000000"])).toEqual([]);
    expect(cleanIds([` ${uuid(1)} `])).toEqual([]);
  });

  it("deduplicates and keeps the order it was given", () => {
    expect(cleanIds([uuid(1), uuid(2), uuid(1)])).toEqual([uuid(1), uuid(2)]);
  });

  it("caps the batch so a caller cannot post an unbounded id list at the database", () => {
    const many = Array.from({ length: MAX_IDS + 50 }, (_, i) =>
      `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`
    );
    expect(cleanIds(many)).toHaveLength(MAX_IDS);
    expect(MAX_IDS).toBe(100);
  });

  it("caps after deduplicating, so repeats cannot squeeze out real ids", () => {
    const dupes = Array.from({ length: 40 }, () => uuid(1));
    const rest = Array.from({ length: MAX_IDS }, (_, i) =>
      `${String(i + 10).padStart(8, "0")}-0000-4000-8000-000000000000`
    );
    expect(cleanIds([...dupes, ...rest])).toHaveLength(MAX_IDS);
  });

  // The pattern accepts either case and Postgres compares uuids by value, so two casings of one id
    // are one id, and letting both through spent two of the cap's slots on it.
  it("treats the same uuid in different cases as one id", () => {
    const mixed = "abcdef01-0000-4000-8000-00000000000a";
    expect(cleanIds([mixed, mixed.toUpperCase()])).toHaveLength(1);
  });
});

describe("ordinal", () => {
  it("names the ordinary suffixes", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(23)).toBe("23rd");
  });

  it("gets the teens right, which is where the naive version breaks", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(111)).toBe("111th");
    expect(ordinal(112)).toBe("112th");
    expect(ordinal(113)).toBe("113th");
  });

  it("covers both ends of a percentile", () => {
    // 0 and 100 are both reachable: an app cleaner than nobody, and one cleaner than everybody.
    expect(ordinal(0)).toBe("0th");
    expect(ordinal(100)).toBe("100th");
    expect(ordinal(101)).toBe("101st");
  });
});

describe("recoveryMarks", () => {
  it("marks nothing on a grade no challenge ever touched", () => {
    expect(recoveryMarks({})).toEqual({
      retry: false,
      none: false,
      partial: false,
      full: false,
      limited: false,
    });
  });

  it("marks only B while a pass is still booked, since the score may still change", () => {
    const m = recoveryMarks({
      retryDueAt: "2026-09-01T00:10:00Z",
      retryPasses: 1,
      initial: 10,
      blocked: 4,
    });
    expect(m.retry).toBe(true);
    expect([m.none, m.partial, m.full]).toEqual([false, false, false]);
  });

  it("marks N when a completed recovery got nothing back", () => {
    const m = recoveryMarks({ retryPasses: 2, initial: 8, blocked: 8 });
    expect(m).toMatchObject({ retry: false, none: true, partial: false, full: false });
  });

  it("marks P when a completed recovery got some of the tail back", () => {
    const m = recoveryMarks({ retryPasses: 1, initial: 10, blocked: 4 });
    expect(m).toMatchObject({ none: false, partial: true, full: false });
  });

  it("marks F when the whole blocked tail came back", () => {
    const m = recoveryMarks({ retryPasses: 1, initial: 10, blocked: 0 });
    expect(m).toMatchObject({ none: false, partial: false, full: true });
  });

  it("keeps N, P and F mutually exclusive on every shape it is given", () => {
    for (const initial of [0, 1, 5, 10]) {
      for (const blocked of [0, 1, 5, 10, 20]) {
        for (const passes of [0, 1, 3]) {
          const m = recoveryMarks({ retryPasses: passes, initial, blocked });
          expect([m.none, m.partial, m.full].filter(Boolean).length).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("marks nothing about recovery before a pass has run", () => {
    // retry_blocked_initial is NULL until the first pass (migration 0021), so a grade with blocked
    // probes and no pass yet must not read as a recovery that recovered nothing.
    const m = recoveryMarks({ retryPasses: 0, initial: null, blocked: 6 });
    expect(m).toMatchObject({ retry: false, none: false, partial: false, full: false });
  });

  it("survives a blocked count larger than the count recovery began with", () => {
    // blocked_probes only ever shrinks, so this should not happen, but a negative recovered count
    // must not turn into a partial recovery.
    const m = recoveryMarks({ retryPasses: 1, initial: 5, blocked: 9 });
    expect(m).toMatchObject({ none: true, partial: false, full: false });
  });

  it("lets L sit beside any other mark, and only on an explicit true", () => {
    expect(recoveryMarks({ limitedEngagement: true }).limited).toBe(true);
    expect(recoveryMarks({ limitedEngagement: null }).limited).toBe(false);
    expect(recoveryMarks({ limitedEngagement: false }).limited).toBe(false);
    expect(recoveryMarks({}).limited).toBe(false);
    const both = recoveryMarks({ retryDueAt: "2026-09-01T00:10:00Z", limitedEngagement: true });
    expect(both).toMatchObject({ retry: true, limited: true });
  });
});

describe("isLimitedEngagement", () => {
  it("reads the grader's own reporting status", () => {
    expect(isLimitedEngagement({ reporting: { status: "limited_engagement" } })).toBe(true);
    expect(isLimitedEngagement({ reporting: { status: "completed" } })).toBe(false);
  });

  it("says no when there is no ranking to read", () => {
    // A grade the grader declined to place stores a null ranking, and absence is not a note.
    expect(isLimitedEngagement(null)).toBe(false);
    expect(isLimitedEngagement(undefined)).toBe(false);
    expect(isLimitedEngagement({})).toBe(false);
    expect(isLimitedEngagement({ reporting: {} })).toBe(false);
    expect(isLimitedEngagement("limited_engagement")).toBe(false);
  });
});
