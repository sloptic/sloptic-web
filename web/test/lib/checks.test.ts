import { describe, it, expect } from "vitest";
import {
  AREAS,
  AREA_BLURBS,
  AREA_LABELS,
  CATALOG_URL,
  PASSIVE_BY_AREA,
  TOTALS,
  categoriesFor,
  categoryName,
  describeCategory,
  describeProbe,
  sampleFor,
  type Area,
} from "@/lib/checks";
import { CATEGORY_FACTS, PROBE_INDEX } from "@/lib/checks.generated";
import { LABELS } from "@/lib/check-labels";

// Written out rather than read from AREA_ORDER, on purpose: this is the tripwire. The day the grader
// adds or splits an axis again, this test should fail and send someone to check every place the site
// shows axes, the way 3.0's accessibility split did.
const ALL_AREAS: Area[] = ["security", "qa", "accessibility", "performance"];

// Pinned on purpose. sloptic/safety.py at 3.0.0 classifies 45 passive and 61 active of 106, and
// passive-2026.2 was built from exactly that selection. A drift here is not a cosmetic mismatch, it
// is the product and the frozen curve measuring different things, and every page quoting a count
// needs a human to look at it.
describe("the battery totals", () => {
  it("counts the 106 checks the 3.0 catalog holds, 45 of them passive", () => {
    expect(TOTALS).toEqual({ total: 106, passive: 45, active: 61 });
  });

  it("splits every check into exactly one of passive and active", () => {
    expect(TOTALS.passive + TOTALS.active).toBe(TOTALS.total);
  });

  it("adds up from the categories, so the areas cannot quote a different battery", () => {
    expect(CATEGORY_FACTS.reduce((n, f) => n + f.probes, 0)).toBe(TOTALS.total);
    expect(CATEGORY_FACTS.reduce((n, f) => n + f.passive, 0)).toBe(TOTALS.passive);
  });

  it("indexes every probe in the catalog, active ones included", () => {
    // The live progress line names the check it is running, so an unindexed active probe would drop
    // it back to a bare "running the checks".
    expect(Object.keys(PROBE_INDEX)).toHaveLength(TOTALS.total);
  });

  it("agrees with itself about how many probes each category holds", () => {
    const counted: Record<string, number> = {};
    for (const [, slug] of Object.values(PROBE_INDEX)) counted[slug] = (counted[slug] ?? 0) + 1;
    for (const f of CATEGORY_FACTS) expect([f.slug, counted[f.slug]]).toEqual([f.slug, f.probes]);
  });

  it("never claims more passive checks in a category than it has checks", () => {
    for (const f of CATEGORY_FACTS) expect(f.passive).toBeLessThanOrEqual(f.probes);
  });

  it("labels access from the passive count it carries", () => {
    // open: every check runs on any URL. gated: every check needs verification. mixed: some of each.
    for (const f of CATEGORY_FACTS) {
      const expected = f.passive === 0 ? "gated" : f.passive === f.probes ? "open" : "mixed";
      expect([f.slug, f.access]).toEqual([f.slug, expected]);
    }
  });

  it("has no category outside the four axes", () => {
    for (const f of CATEGORY_FACTS) expect(ALL_AREAS).toContain(f.area);
  });
});

describe("AREAS", () => {
  it("lists the four axes the score is split across, in the order the grader reports them", () => {
    expect(AREAS.map((a) => a.id)).toEqual(["security", "qa", "accessibility", "performance"]);
  });

  it("sums each area from its own categories", () => {
    for (const a of AREAS) {
      const facts = CATEGORY_FACTS.filter((f) => f.area === a.id);
      expect(a.probes).toBe(facts.reduce((n, f) => n + f.probes, 0));
      expect(a.passive).toBe(facts.reduce((n, f) => n + f.passive, 0));
      expect(a.categories).toBe(facts.length);
    }
  });

  it("accounts for the whole battery across the four areas", () => {
    expect(AREAS.reduce((n, a) => n + a.probes, 0)).toBe(TOTALS.total);
    expect(AREAS.reduce((n, a) => n + a.passive, 0)).toBe(TOTALS.passive);
  });

  it("carries a label for every area", () => {
    for (const a of AREAS) {
      expect(a.label).toBe(AREA_LABELS[a.id]);
      expect(a.label.length).toBeGreaterThan(0);
    }
  });

  it("has security as the area with the most gated checks", () => {
    // The active tier exists mostly for security, so a passive grade is thinnest here. This is the
    // shape the "clean passive is not secure" copy depends on.
    const gated = (id: Area) => {
      const a = AREAS.find((x) => x.id === id)!;
      return a.probes - a.passive;
    };
    expect(gated("security")).toBeGreaterThan(gated("qa"));
    expect(gated("security")).toBeGreaterThan(gated("performance"));
  });
});

describe("PASSIVE_BY_AREA", () => {
  it("is the per-area denominator for what a passive grade could run", () => {
    for (const a of AREAS) expect(PASSIVE_BY_AREA[a.id]).toBe(a.passive);
  });

  it("adds up to the passive battery", () => {
    expect(ALL_AREAS.reduce((n, id) => n + PASSIVE_BY_AREA[id], 0)).toBe(TOTALS.passive);
  });

  it("covers all four areas, so no area divides by undefined", () => {
    for (const id of ALL_AREAS) expect(typeof PASSIVE_BY_AREA[id]).toBe("number");
  });
});

describe("categoriesFor", () => {
  it("returns only the categories of the area asked for", () => {
    for (const id of ALL_AREAS) {
      const got = categoriesFor(id);
      expect(got.length).toBeGreaterThan(0);
      for (const c of got) expect(c.area).toBe(id);
    }
  });

  it("puts the categories carrying the most checks first", () => {
    const probes = categoriesFor("security").map((c) => c.probes);
    expect([...probes].sort((a, b) => b - a)).toEqual(probes);
  });

  it("breaks a tie on the name, so the order is stable between renders", () => {
    for (const id of ALL_AREAS) {
      const got = categoriesFor(id);
      for (let i = 1; i < got.length; i++) {
        if (got[i - 1].probes === got[i].probes) {
          expect(got[i - 1].name.localeCompare(got[i].name)).toBeLessThan(0);
        }
      }
    }
  });

  it("accounts for every check in the area it describes", () => {
    for (const a of AREAS) {
      expect(categoriesFor(a.id).reduce((n, c) => n + c.probes, 0)).toBe(a.probes);
    }
  });

  it("names every category rather than showing a reader a slug", () => {
    // The fallback to the slug exists so a new category from the grader is visible, not so one can
    // ship unnamed. Every slug in the catalog today has a label and an authority to link to.
    for (const id of ALL_AREAS) {
      for (const c of categoriesFor(id)) {
        expect([c.slug, c.name]).toEqual([c.slug, LABELS[c.slug]?.name]);
        expect(c.href).toBeTruthy();
      }
    }
  });

  it("does not disturb the generated facts it reads", () => {
    const before = JSON.stringify(CATEGORY_FACTS);
    categoriesFor("qa");
    categoriesFor("qa").reverse();
    expect(JSON.stringify(CATEGORY_FACTS)).toBe(before);
  });
});

describe("sampleFor", () => {
  it("takes the biggest categories, since the landing has no room for the tail", () => {
    expect(sampleFor("security", 3)).toEqual(categoriesFor("security").slice(0, 3));
  });

  it("asks for six by default and never invents one that does not exist", () => {
    for (const id of ALL_AREAS) {
      const got = sampleFor(id);
      expect(got.length).toBe(Math.min(6, categoriesFor(id).length));
    }
  });
});

describe("describeProbe", () => {
  it("names a passive probe and the area it scores", () => {
    // Accessibility is its own axis since 3.0; it scored inside quality before, which is why this
    // probe answered "qa" until then.
    expect(describeProbe("qa-a11y-001")).toEqual({ area: "accessibility", name: LABELS.accessibility.name });
  });

  it("names an active probe too, so a live line can say what it is running", () => {
    expect(describeProbe("sec-sqli-001")).toEqual({
      area: "security",
      name: LABELS["sql-injection"].name,
    });
  });

  it("returns null for an id the catalog does not know", () => {
    // A probe id from a newer grader must read as unknown, never as a wrong name.
    expect(describeProbe("sec-not-a-probe-999")).toBeNull();
    expect(describeProbe("")).toBeNull();
  });

  // A bare object inherits from Object.prototype, so PROBE_INDEX["constructor"] answers with a
    // function: truthy, not iterable, and a crash where the contract promises null.
  it("does not answer for a property Object.prototype happens to carry", () => {
    expect(describeProbe("constructor")).toBeNull();
    expect(describeProbe("toString")).toBeNull();
    expect(describeCategory("constructor")).toBeNull();
  });

  it("resolves every id in the index", () => {
    for (const id of Object.keys(PROBE_INDEX)) {
      const hit = describeProbe(id);
      expect(hit).not.toBeNull();
      expect(ALL_AREAS).toContain(hit!.area);
    }
  });
});

describe("describeCategory", () => {
  it("carries the slug as well as the name, which grouping needs", () => {
    expect(describeCategory("sec-headers-001")).toEqual({
      area: "security",
      slug: "security-headers",
      name: LABELS["security-headers"].name,
    });
  });

  it("returns null for an unknown probe id", () => {
    expect(describeCategory("perf-not-a-probe-999")).toBeNull();
  });

  it("agrees with describeProbe about the area", () => {
    for (const id of Object.keys(PROBE_INDEX)) {
      expect(describeCategory(id)!.area).toBe(describeProbe(id)!.area);
    }
  });
});

describe("categoryName", () => {
  it("joins a grader slug to the hand-written name", () => {
    expect(categoryName("security-headers")).toBe(LABELS["security-headers"].name);
  });

  it("falls back to the slug, so a new category shows up as something to name", () => {
    expect(categoryName("brand-new-category")).toBe("brand-new-category");
    expect(categoryName("")).toBe("");
  });

  // Same inheritance, quieter result: categoryName answered "Object" instead of the slug.
  it("does not return an inherited property for a slug that shadows one", () => {
    expect(categoryName("constructor")).toBe("constructor");
  });
});

describe("the editorial copy", () => {
  it("blurbs all four areas", () => {
    for (const id of ALL_AREAS) expect(AREA_BLURBS[id].length).toBeGreaterThan(0);
  });

  it("writes without em dashes, as the house style requires", () => {
    for (const id of ALL_AREAS) {
      expect(AREA_BLURBS[id]).not.toMatch(/[—–]/);
      expect(AREA_LABELS[id]).not.toMatch(/[—–]/);
    }
    for (const l of Object.values(LABELS)) expect(l.name).not.toMatch(/[—–]/);
  });

  it("points at the catalog in the grader repo, which is the authority on the checks", () => {
    expect(CATALOG_URL).toMatch(/^https:\/\/github\.com\/.*sloptic-main.*catalog$/);
  });

  it("links every label at a public authority over https", () => {
    for (const [slug, l] of Object.entries(LABELS)) {
      expect([slug, l.href?.startsWith("https://")]).toEqual([slug, true]);
    }
  });
});

// ---- prices ----------------------------------------------------------------------------------------

import {
  PROBE_FACTS,
  SCORING,
  categorySpan,
  dampedTotal,
  groupSiblings,
  measuredText,
  priceLabel,
  priceNotes,
  probeName,
  rungsFor,
  sharedRungs,
} from "@/lib/checks";
import { PROBE_NAMES, RUNG_TEXT } from "@/lib/check-labels";

describe("the price list", () => {
  it("prices every probe the index knows, and no other", () => {
    expect(PROBE_FACTS.map((f) => f.id).sort()).toEqual(Object.keys(PROBE_INDEX).sort());
  });

  it("agrees with the index about each probe's area and category", () => {
    for (const f of PROBE_FACTS) expect([f.id, f.area, f.category]).toEqual([f.id, ...PROBE_INDEX[f.id]]);
  });

  it("names every check", () => {
    expect(PROBE_FACTS.filter((f) => !Object.hasOwn(PROBE_NAMES, f.id)).map((f) => f.id)).toEqual([]);
  });

  it("keeps no name for a check the catalog no longer has", () => {
    const ids = new Set(PROBE_FACTS.map((f) => f.id));
    expect(Object.keys(PROBE_NAMES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("names every rung in words", () => {
    // A rung without a label would render its raw evidence flag ("cross_user_read") on a public page.
    const missing = PROBE_FACTS.flatMap((f) =>
      f.pricing.kind === "ladder"
        ? f.pricing.rungs.map((r) => `${f.category}:${r.evidence}`).filter((k) => !Object.hasOwn(RUNG_TEXT, k))
        : [],
    );
    expect(missing).toEqual([]);
  });

  it("keeps no label for a rung the catalog no longer has", () => {
    const used = new Set(
      PROBE_FACTS.flatMap((f) =>
        f.pricing.kind === "ladder" ? f.pricing.rungs.map((r) => `${f.category}:${r.evidence}`) : [],
      ),
    );
    expect(Object.keys(RUNG_TEXT).filter((k) => !used.has(k))).toEqual([]);
  });

  it("explains every measured price", () => {
    // Each measured check is priced by its own formula, written by hand; a new one needs its own line.
    const unexplained = PROBE_FACTS.filter((f) => f.pricing.kind === "measured" && !measuredText(f));
    expect(unexplained.map((f) => f.id)).toEqual([]);
  });

  it("orders every ladder upward, inside its range", () => {
    for (const f of PROBE_FACTS) {
      if (f.pricing.kind !== "ladder") continue;
      const pts = f.pricing.rungs.map((r) => r.points);
      expect([f.id, pts]).toEqual([f.id, [...pts].sort((a, b) => a - b)]);
      expect(pts[0]).toBeGreaterThan(f.pricing.from);
      expect(pts[pts.length - 1]).toBe(f.pricing.to);
    }
  });

  it("reads each kind of price the way the table shows it", () => {
    expect(priceLabel({ kind: "fixed", points: 8 })).toBe("8");
    expect(priceLabel({ kind: "ladder", from: 30, to: 85, rungs: [] })).toBe("30 to 85");
    expect(priceLabel({ kind: "measured", nominal: 20 })).toBe("measured");
    expect(priceLabel({ kind: "off" })).toBe("off-score");
  });

  it("lists what lifts a price, in the rung's own words", () => {
    const idor = PROBE_FACTS.find((f) => f.id === "sec-idor-001")!;
    expect(rungsFor(idor)[0]).toEqual({ points: 55, text: "reads another user's record" });
    expect(rungsFor(PROBE_FACTS.find((f) => f.id === "sec-headers-002")!)).toEqual([]);
  });

  it("says a zero floor costs nothing until proven", () => {
    const deploy = PROBE_FACTS.find((f) => f.id === "qa-deploy-001")!;
    expect(priceNotes(deploy)).toContain("Free until proven.");
  });

  it("notes the re-pricing and the shared flaws", () => {
    const csp = PROBE_FACTS.find((f) => f.id === "sec-headers-002")!;
    expect(priceNotes(csp)).toEqual(["Rises to 24 in a grade with cross-site scripting or scripting in the browser."]);
    const sqli = PROBE_FACTS.find((f) => f.id === "sec-sqli-001")!;
    expect(priceNotes(sqli)).toEqual([
      "Same flaw as sec-sqli-002, sec-sqli-003 and sec-sqli-005. Only the highest counts.",
    ]);
  });

  it("shows a ladder once when every ladder in the category shares it", () => {
    const of = (cat: string) => PROBE_FACTS.filter((f) => f.category === cat);
    expect(sharedRungs(of("access-control"))?.map((r) => r.points)).toEqual([55, 68, 78, 85]);
    expect(sharedRungs(of("file-upload"))).toBeNull(); // two ladders, different rungs
    expect(sharedRungs(of("exposure"))).toBeNull(); // only one ladder
  });

  it("spans a category from its cheapest check to its dearest", () => {
    const of = (cat: string) => PROBE_FACTS.filter((f) => f.category === cat);
    expect(categorySpan(of("security-headers"))).toBe("2 to 8");
    expect(categorySpan(of("access-control"))).toBe("30 to 90");
    expect(categorySpan(of("web-vitals"))).toBe("off-score");
    expect(categorySpan(of("accessibility"))).toBe("measured");
  });

  it("works the Lighthouse example the way the grader prices it", () => {
    const lh = PROBE_FACTS.find((f) => f.id === SCORING.lighthouse.id)!;
    expect(measuredText(lh)).toBe("1 point per Lighthouse point below 90. An 84 costs 6.");
  });

  it("finds the other checks that share a flaw", () => {
    const sqli = PROBE_FACTS.find((f) => f.id === "sec-sqli-001")!;
    expect(groupSiblings(sqli).sort()).toEqual(["sec-sqli-002", "sec-sqli-003", "sec-sqli-005"]);
    expect(groupSiblings(PROBE_FACTS.find((f) => f.id === "sec-headers-002")!)).toEqual([]);
  });

  // Everything this page publishes about a check, in the words a reader sees.
  const published = () => [
    ...PROBE_FACTS.map(probeName),
    ...Object.values(RUNG_TEXT),
    ...PROBE_FACTS.flatMap(priceNotes),
  ];

  it("writes the published copy without em dashes", () => {
    for (const line of published()) expect(line).not.toContain("\u2014");
  });

  it("keeps every sentence simple", () => {
    // House rule for this page: no compound or complex sentences. A semicolon, a comma before a
    // joining word, or a subordinating word is how one creeps back in.
    const joins = /;|, (and|but|or|so) | (if|because|unless|when|while|although|since|which|whose) /i;
    for (const line of published()) expect([line, joins.test(line)]).toEqual([line, false]);
  });
});

describe("dampedTotal", () => {
  it("counts the worst in full and each further one at the decay of the one before", () => {
    // The grader's CATEGORY_DECAY is 0.6: 8 + 5 x 0.6 + 5 x 0.36.
    expect(SCORING.categoryDecay).toBe(0.6);
    expect(dampedTotal([5, 8, 5])).toBe(12.8);
  });

  it("never lets a category cost more than 2.5 times its worst finding", () => {
    // 1 / (1 - 0.6): the geometric series only approaches it, so at one decimal fifty repeats reach it.
    expect(dampedTotal(Array(10).fill(10))).toBeLessThan(25);
    expect(dampedTotal(Array(50).fill(10))).toBeLessThanOrEqual(25);
  });
});
