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

const ALL_AREAS: Area[] = ["security", "qa", "performance"];

// CLAUDE.md fixes these three numbers: sloptic/safety.py classifies 44 passive and 58 active of 102,
// and the passive curve was built from exactly that selection. A drift here is not a cosmetic
// mismatch, it is the product and the frozen curve measuring different things.
describe("the battery totals", () => {
  it("counts the 102 checks the catalog holds, 44 of them passive", () => {
    expect(TOTALS).toEqual({ total: 102, passive: 44, active: 58 });
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

  it("has no category outside the three axes", () => {
    for (const f of CATEGORY_FACTS) expect(ALL_AREAS).toContain(f.area);
  });
});

describe("AREAS", () => {
  it("lists the three axes the score is split across, in score order", () => {
    expect(AREAS.map((a) => a.id)).toEqual(["security", "qa", "performance"]);
  });

  it("sums each area from its own categories", () => {
    for (const a of AREAS) {
      const facts = CATEGORY_FACTS.filter((f) => f.area === a.id);
      expect(a.probes).toBe(facts.reduce((n, f) => n + f.probes, 0));
      expect(a.passive).toBe(facts.reduce((n, f) => n + f.passive, 0));
      expect(a.categories).toBe(facts.length);
    }
  });

  it("accounts for the whole battery across the three areas", () => {
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

  it("covers all three areas, so no area divides by undefined", () => {
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
    expect(describeProbe("qa-a11y-001")).toEqual({ area: "qa", name: LABELS.accessibility.name });
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
  it("blurbs all three areas", () => {
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
