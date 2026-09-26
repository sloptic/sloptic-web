// Joins the generated facts to the hand-written labels. Pages import from here, never from either
// half directly, so the counts always come from the grader and the wording always comes from us.

import {
  AREA_ORDER,
  CATEGORY_FACTS,
  GRADER_VERSION,
  PROBE_FACTS,
  PROBE_INDEX,
  SCORING,
  TOTALS,
  type Area,
  type Access,
  type CategoryFact,
  type Pricing,
  type ProbeFact,
} from "./checks.generated";
import { AREA_LABELS, LABELS, PROBE_NAMES, RUNG_TEXT } from "./check-labels";

export { TOTALS, AREA_ORDER, SCORING, PROBE_FACTS };
export { AREA_LABELS };
export type { Area, Access, CategoryFact, Pricing, ProbeFact };

// Pinned to the release tag the worker runs, never `main`: main runs ahead of the pin (it will carry
// the 4.0 ruler while the site still grades on 3.x), so a link to it can describe prices and checks
// this site does not use. Moving the pin moves these with it.
const GRADER_TREE = `https://github.com/sloptic/sloptic-main/tree/v${GRADER_VERSION}`;
const GRADER_BLOB = `https://github.com/sloptic/sloptic-main/blob/v${GRADER_VERSION}`;
export const CATALOG_URL = `${GRADER_TREE}/catalog`;
export const RATIONALE_URL = `${GRADER_BLOB}/docs/PENALTY_RATIONALE.md`;
export { GRADER_VERSION };

export type Category = CategoryFact & { name: string; href?: string };

/** A category with no label yet falls back to its slug, so a new one from the grader is visible. */
function label(fact: CategoryFact): Category {
  const l = LABELS[fact.slug];
  return { ...fact, name: l?.name ?? fact.slug, href: l?.href };
}

/** Categories in an area, biggest first, so the areas that carry the most checks read first. */
export function categoriesFor(area: Area): Category[] {
  return CATEGORY_FACTS.filter((f) => f.area === area)
    .map(label)
    .sort((a, b) => b.probes - a.probes || a.name.localeCompare(b.name));
}

// From the generated order, never a list typed here. A hand-written ["security", "qa", "performance"]
// is a valid Area[] even after 3.0 split accessibility out, so the type checker cannot catch it: it
// just stops showing the fourth axis. That is how a real subtotal goes missing without an error.
export const AREAS: { id: Area; label: string; probes: number; passive: number; categories: number }[] =
  AREA_ORDER.map((id) => {
  const facts = CATEGORY_FACTS.filter((f) => f.area === id);
  return {
    id,
    label: AREA_LABELS[id],
    probes: facts.reduce((n, f) => n + f.probes, 0),
    passive: facts.reduce((n, f) => n + f.passive, 0),
    categories: facts.length,
  };
});

/** What the landing says about each area. Editorial, so it lives here rather than in the catalog. */
export const AREA_BLURBS: Record<Area, string> = {
  security:
    "Getting this wrong costs the people who trusted your app. Sloptic looks for missing defenses and secrets left in the code you ship, following the OWASP Top 10.",
  qa: "Apps that are unusable or crash unexpectedly frusturate users. Sloptic checks for broken links, error handling, dead controls, and other quality issues that degrade the user experience.",
  accessibility:
    "An app some people cannot use is broken for them, whatever it looks like to you. Sloptic checks every page against WCAG with axe: contrast, labels, and the rest.",
  performance:
    "Most people will not wait for a slow app, so Sloptic uses Lighthouse to measure real load speed and page weight.",
};

/** A few named checks per area, for the landing, where the full list would be too much. */
export function sampleFor(area: Area, n = 6): Category[] {
  return categoriesFor(area).slice(0, n);
}

/** What a probe id was, for naming a check that passed or one running now. The grade record only
 *  names the ones that fired, so a check would otherwise be an opaque id. Every probe is indexed,
 *  active included, so the live progress line can name an active check instead of falling back to a
 *  bare "running the checks". */
export function describeProbe(id: string): { area: Area; name: string } | null {
  const hit = Object.hasOwn(PROBE_INDEX, id) ? PROBE_INDEX[id] : undefined;
  if (!hit) return null;
  const [area, slug] = hit;
  return { area, name: labelFor(slug)?.name ?? slug };
}

/** The category a probe belongs to, slug plus labeled name. Grouping surfaces (what failed, what
 *  passed, what a challenge blocked) need this, not the per-probe name the index does not carry. */
export function describeCategory(id: string): { area: Area; slug: string; name: string } | null {
  const hit = Object.hasOwn(PROBE_INDEX, id) ? PROBE_INDEX[id] : undefined;
  if (!hit) return null;
  const [area, slug] = hit;
  return { area, slug, name: labelFor(slug)?.name ?? slug };
}

/** A category slug as a reader meets it. Findings carry slugs straight from the grader, so this is
 *  the join to the hand-written half; an unnamed slug falls back to itself and shows up as
 *  something to name. */
export function categoryName(slug: string): string {
  return labelFor(slug)?.name ?? slug;
}

/** Own properties only. A bare object inherits from Object.prototype, so LABELS["constructor"]
 *  answers with a function and categoryName returned "Object" for it. */
function labelFor(slug: string) {
  return Object.hasOwn(LABELS, slug) ? LABELS[slug] : undefined;
}

/** Passive checks per area, the denominator for "of everything this mode could run". */
export const PASSIVE_BY_AREA: Record<Area, number> = AREAS.reduce(
  (acc, a) => ({ ...acc, [a.id]: a.passive }),
  {} as Record<Area, number>,
);

// ---- prices --------------------------------------------------------------------------------------

/** A price as the table's number column shows it. */
export function priceLabel(p: Pricing): string {
  switch (p.kind) {
    case "fixed":
      return String(p.points);
    case "ladder":
      return `${p.from} to ${p.to}`;
    case "measured":
      return "measured";
    case "off":
      return "off-score";
  }
}

/** A check's short name. Falls back to the grader's own description, then the id, so a new probe
 *  still renders; the checks test requires a name for every probe. */
export function probeName(f: ProbeFact): string {
  return Object.hasOwn(PROBE_NAMES, f.id) ? PROBE_NAMES[f.id] : (f.expected ?? f.id);
}

/** The prices a ladder climbs to, each with what it takes. A rung with no label shows its raw flag,
 *  which the checks test forbids. */
export function rungsFor(f: ProbeFact): { points: number; text: string }[] {
  if (f.pricing.kind !== "ladder") return [];
  return f.pricing.rungs.map((r) => {
    const key = `${f.category}:${r.evidence}`;
    return { points: r.points, text: Object.hasOwn(RUNG_TEXT, key) ? RUNG_TEXT[key] : r.evidence };
  });
}

/** The ladder every priced-by-proof check in a category shares, or null. Access control has six checks
 *  climbing the same four rungs; listing them six times buries the checks, so a shared ladder is shown
 *  once for the category. Needs at least two ladders, all identical. */
export function sharedRungs(probes: ProbeFact[]): { points: number; text: string }[] | null {
  const ladders = probes.filter((f) => f.pricing.kind === "ladder");
  if (ladders.length < 2) return null;
  const sig = (f: ProbeFact) => JSON.stringify([f.pricing, rungsFor(f)]);
  return ladders.every((f) => sig(f) === sig(ladders[0])) ? rungsFor(ladders[0]) : null;
}

/** One decimal, dropped when whole. Rounded first: (0.90 - 0.84) * 100 is 6.000000000000005. */
const fmt1 = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** How a measured check is priced. Written per probe because each measures something different; the
 *  constants come from the grader wherever it exposes them. */
export function measuredText(f: ProbeFact): string | null {
  if (f.pricing.kind !== "measured") return null;
  const t = SCORING.a11yTiers;
  const lh = SCORING.lighthouse;
  const floor = Math.round(lh.greenFloor * 100);
  const text: Record<string, string> = {
    [lh.id]: `${fmt1(lh.scale)} point per Lighthouse point below ${floor}. An 84 costs ${fmt1((lh.greenFloor - 0.84) * 100 * lh.scale)}.`,
    "qa-a11y-001":
      `Each barrier costs its impact: critical ${t.critical}, serious ${t.serious}, moderate ${t.moderate}, ` +
      `minor ${t.minor}. Low contrast costs its shortfall. Each extra barrier counts ` +
      `${fmt1(SCORING.a11yDecay * 100)}% of the one before.`,
    "qa-a11y-002": "The same prices, read from the markup.",
    "qa-links-001": `${f.pricing.nominal} to ${f.pricing.nominal * 2}, by the share of dead links.`,
    "sec-deps-001": "The worst CVE's CVSS score times ten.",
  };
  return Object.hasOwn(text, f.id) ? text[f.id] : null;
}

/** Everything about a check's price that its number and rungs do not say, one short line each. */
export function priceNotes(f: ProbeFact): string[] {
  const notes: string[] = [];
  const measured = measuredText(f);
  if (measured) notes.push(measured);
  if (f.pricing.kind === "off") notes.push("Shown on the report. Adds nothing to the score.");
  if (f.pricing.kind === "ladder" && f.pricing.from === 0) notes.push("Free until proven.");
  if (f.raised) {
    const when = f.raised.when.map(categoryName).sort().join(" or ");
    notes.push(`Rises to ${f.raised.to} in a grade with ${when}.`);
  }
  const siblings = groupSiblings(f);
  if (siblings.length) {
    const list =
      siblings.length === 1 ? siblings[0] : `${siblings.slice(0, -1).join(", ")} and ${siblings[siblings.length - 1]}`;
    notes.push(`Same flaw as ${list}. Only the highest counts.`);
  }
  return notes;
}

/** A category's price span for its collapsed row: the lowest and highest a check in it can cost.
 *  Measured and off-score checks carry no fixed span, so they are left out; a category of only those
 *  says so instead. */
export function categorySpan(probes: ProbeFact[]): string {
  const lo: number[] = [];
  const hi: number[] = [];
  for (const f of probes) {
    if (f.pricing.kind === "fixed") {
      lo.push(f.pricing.points);
      hi.push(f.pricing.points);
    } else if (f.pricing.kind === "ladder") {
      lo.push(f.pricing.from);
      hi.push(f.pricing.to);
    }
  }
  if (!lo.length) return probes.every((f) => f.pricing.kind === "off") ? "off-score" : "measured";
  const min = Math.min(...lo);
  const max = Math.max(...hi);
  return min === max ? String(min) : `${min} to ${max}`;
}

/** The other checks that find the same flaw, which only ever count once between them. */
export function groupSiblings(f: ProbeFact): string[] {
  if (!f.group) return [];
  return PROBE_FACTS.filter((o) => o.group === f.group && o.id !== f.id).map((o) => o.id);
}

/** Probes in an area, in the order categoriesFor lists their categories. */
export function probesFor(area: Area): { category: Category; probes: ProbeFact[] }[] {
  return categoriesFor(area).map((category) => ({
    category,
    probes: PROBE_FACTS.filter((f) => f.area === area && f.category === category.slug).sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    ),
  }));
}

/** What findings of ONE category add after the grader's per-category decay (sloptic.aggregate
 *  _damped_total): sorted worst first, the i-th counts at decay^i. Used for worked examples, never
 *  to score a grade; the grader does that. */
export function dampedTotal(prices: number[], decay: number = SCORING.categoryDecay): number {
  const total = [...prices].sort((a, b) => b - a).reduce((sum, p, i) => sum + p * decay ** i, 0);
  return Math.round(total * 10) / 10;
}
