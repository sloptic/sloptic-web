// Joins the generated facts to the hand-written labels. Pages import from here, never from either
// half directly, so the counts always come from the grader and the wording always comes from us.

import {
  CATEGORY_FACTS,
  PASSIVE_PROBE_INDEX,
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
    "Getting this wrong costs the people who trusted your app, not you. Sloptic looks for missing defenses and secrets left in the code you ship, following OWASP.",
  qa: "An app a screen reader cannot operate is closed to the people who rely on one. Sloptic checks whether controls work and whether pages fail honestly, using axe-core against WCAG.",
  performance:
    "Most people will not wait for a slow app, so Sloptic measures real load speed and page weight as Google's Core Web Vitals.",
};

/** A few named checks per area, for the landing, where the full list would be too much. */
export function sampleFor(area: Area, n = 6): Category[] {
  return categoriesFor(area).slice(0, n);
}

/** What a probe id was, for naming a check that passed. The grade record only names the ones that
 *  fired, so a passing check would otherwise be an opaque id. */
export function describeProbe(id: string): { area: Area; name: string } | null {
  const hit = PASSIVE_PROBE_INDEX[id];
  if (!hit) return null;
  const [area, slug] = hit;
  return { area, name: LABELS[slug]?.name ?? slug };
}

/** Passive checks per area, the denominator for "of everything this mode could run". */
export const PASSIVE_BY_AREA: Record<Area, number> = AREAS.reduce(
  (acc, a) => ({ ...acc, [a.id]: a.passive }),
  {} as Record<Area, number>,
);
