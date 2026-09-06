// Joins the generated facts to the hand-written labels. Pages import from here, never from either
// half directly, so the counts always come from the grader and the wording always comes from us.

import {
  CATEGORY_FACTS,
  PROBE_INDEX,
  TOTALS,
  type Area,
  type Access,
  type CategoryFact,
} from "./checks.generated";
import { AREA_LABELS, LABELS } from "./check-labels";

export { TOTALS };
export { AREA_LABELS };
export type { Area, Access, CategoryFact };

export const CATALOG_URL = "https://github.com/sloptic/sloptic-main/tree/main/catalog";

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

export const AREAS: { id: Area; label: string; probes: number; passive: number; categories: number }[] = (
  ["security", "qa", "performance"] as Area[]
).map((id) => {
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
  qa: "Apps that are unusable or crash unexpectedly frusturate users. Sloptic checks for inaccessibility (WCAG), broken links, error handling, and other quality issues that degrade the user experience.",
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
