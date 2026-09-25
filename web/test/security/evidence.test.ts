/** The evidence visibility rule (Ian, 2026-09-24).
 *
 *  Where a secret, an open backend or an exposed file lives, and how to reproduce it, is shown only to
 *  a verified owner of the app. Everyone else sees what the finding is, its category and its cost. A
 *  report is readable by anyone holding its link, and the grades this covers are the ones strangers
 *  hold, so without it the site would be a directory of where to find other people's leaked keys.
 *
 *  These fixtures carry the SHAPES real stored findings have (checked against production, structure
 *  only): a secrets finding with a target path, a reason and an evidence.repro; an exposure finding
 *  whose evidence names a source map and samples the app's sources.
 */
import { describe, it, expect } from "vitest";
import { isGatedProbe, withholdEvidence, hasGatedFindings } from "@/lib/evidence";
import type { GradeResult } from "@/lib/types";

const SECRET = {
  probe_id: "sec-secrets-001",
  bundle: "security",
  category: "secrets-exposure",
  outcome: "slop_detected",
  penalty: 70,
  contribution: 70,
  variant_group_id: "secrets-bundle",
  reason: "a live key in /assets/index-abc123.js",
  target: "/assets/index-abc123.js",
  evidence: { repro: { method: "GET", url: "https://victim.example/assets/index-abc123.js" }, status: 200 },
};
const EXPOSURE = {
  probe_id: "sec-exposure-003",
  bundle: "security",
  category: "exposure",
  outcome: "slop_detected",
  penalty: 20,
  contribution: 20,
  reason: "source map at /assets/app.js.map reconstructs 6 app sources",
  target: "",
  evidence: { source_map: "/assets/app.js.map", app_source_sample: ["src/App.tsx"], reconstructable: true },
};
const HEADER = {
  probe_id: "sec-headers-002",
  bundle: "security",
  category: "security-headers",
  outcome: "slop_detected",
  penalty: 8,
  contribution: 8,
  reason: "no content-security-policy header",
  target: "/",
  evidence: { header: "content-security-policy" },
};

function result(over: Record<string, unknown> = {}): GradeResult {
  return {
    mode: "passive",
    slop_score: 98,
    axis_slop: { security: 98 },
    findings: [SECRET, EXPOSURE, HEADER],
    outcomes: [SECRET, EXPOSURE, HEADER],
    card: {
      sections: [
        {
          axis: "security",
          entries: [
            {
              probe_id: "sec-secrets-001",
              title: SECRET.reason,
              actual: "key kind: gemini (seen on: /assets/index-abc123.js)",
              expected: "No credential ships in client code.",
              indicates: "Anyone can bill your account.",
              remediation: "Move the call server side and rotate the key.",
              penalty: 70,
            },
            {
              probe_id: "sec-exposure-003",
              title: EXPOSURE.reason,
              actual: "source_map = /assets/app.js.map",
              expected: "Source maps are not served.",
              // The grader's fallback when a probe has no written copy: the finding's own reason.
              indicates: EXPOSURE.reason,
              remediation: "Stop publishing source maps.",
              penalty: 20,
            },
            { probe_id: "sec-headers-002", title: HEADER.reason, actual: "header missing", penalty: 8 },
          ],
        },
      ],
    },
    ...over,
  } as unknown as GradeResult;
}

const find = (r: GradeResult, id: string) =>
  (r.findings as unknown as Record<string, unknown>[]).find((f) => f.probe_id === id)!;

describe("which findings the rule covers", () => {
  it("covers the secrets, backend and exposure families, by prefix", () => {
    for (const id of ["sec-secrets-001", "sec-secrets-003", "sec-backend-004", "sec-exposure-009"]) {
      expect(isGatedProbe(id)).toBe(true);
    }
  });

  it("leaves every other finding alone", () => {
    for (const id of ["sec-headers-002", "sec-csp-001", "qa-a11y-001", "perf-lcp-001", "sec-session-006"]) {
      expect(isGatedProbe(id)).toBe(false);
    }
  });

  it("knows when a result has anything to withhold", () => {
    expect(hasGatedFindings(result())).toBe(true);
    expect(hasGatedFindings(result({ findings: [HEADER] }))).toBe(false);
  });
});

describe("what a stranger sees of a gated finding", () => {
  const r = withholdEvidence(result());

  it("keeps what it is, its axis, its category and what it cost", () => {
    const f = find(r, "sec-secrets-001");
    expect(f).toMatchObject({
      probe_id: "sec-secrets-001",
      bundle: "security",
      category: "secrets-exposure",
      penalty: 70,
      contribution: 70,
      withheld: true,
    });
  });

  it("drops where it is and how to reproduce it", () => {
    for (const id of ["sec-secrets-001", "sec-exposure-003"]) {
      const f = find(r, id);
      expect(f.evidence).toBeUndefined();
      expect(f.target).toBeUndefined();
      expect(f.reason).toBeUndefined();
    }
  });

  it("carries no trace of the location anywhere in the result", () => {
    // The whole-document check, because a location has more than one way out: the finding, its
    // outcome, and two separate fields of its card entry.
    const text = JSON.stringify(r);
    for (const leak of ["index-abc123", "victim.example", "app.js.map", "src/App.tsx", "repro"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("withholds a field the grader adds later, since it is an allowlist", () => {
    // 3.0 added evidence fields; 3.1 will add more. A list of fields to strip would pass the next
    // one straight through to strangers.
    const r2 = withholdEvidence(result({ findings: [{ ...SECRET, location_hint: "/assets/x.js" }] }));
    expect(find(r2, "sec-secrets-001").location_hint).toBeUndefined();
  });

  it("does the same to the matching outcomes", () => {
    const o = (r.outcomes as unknown as Record<string, unknown>[]).find((x) => x.probe_id === "sec-secrets-001")!;
    expect(o.evidence).toBeUndefined();
    expect(o.target).toBeUndefined();
  });
});

describe("what a stranger sees of a gated card entry", () => {
  const entries = (withholdEvidence(result()).card as unknown as { sections: { entries: Record<string, unknown>[] }[] })
    .sections[0].entries;
  const entry = (id: string) => entries.find((e) => e.probe_id === id)!;

  it("keeps the written explanation, which says nothing about this app", () => {
    expect(entry("sec-secrets-001")).toMatchObject({
      expected: "No credential ships in client code.",
      indicates: "Anyone can bill your account.",
      remediation: "Move the call server side and rotate the key.",
    });
  });

  it("drops the title and the what-we-saw line, both built from the finding", () => {
    expect(entry("sec-secrets-001").title).toBeUndefined();
    expect(entry("sec-secrets-001").actual).toBeUndefined();
  });

  it("drops `indicates` when it is the grader's fallback to the finding's reason", () => {
    expect(entry("sec-exposure-003").indicates).toBeUndefined();
    expect(entry("sec-exposure-003").remediation).toBe("Stop publishing source maps.");
  });
});

describe("what the rule leaves alone", () => {
  const r = withholdEvidence(result());

  it("leaves an ungated finding exactly as it was", () => {
    expect(find(r, "sec-headers-002")).toEqual(HEADER);
  });

  it("does not touch the score or the axes", () => {
    expect(r.slop_score).toBe(98);
    expect(r.axis_slop).toEqual({ security: 98 });
  });

  it("returns a copy, and the stored result is not mutated", () => {
    const original = result();
    withholdEvidence(original);
    expect(find(original, "sec-secrets-001").evidence).toBeDefined();
  });
});
