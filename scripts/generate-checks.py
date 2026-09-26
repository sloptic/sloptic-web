#!/usr/bin/env python3
"""Emit the check facts the site displays, straight from the grader's catalog.

The web repo must not keep its own copy of what Sloptic checks: the moment a probe lands in
sloptic-main, a hand-maintained list here starts lying. So the FACTS (which categories exist, how
many probes each holds, and whether they run on any URL) are generated, and only the human LABELS
are written by hand, in web/lib/check-labels.ts.

Output is committed so the Vercel build never needs the sibling repo. Rerun after a catalog change
and drift shows up as a diff instead of silently going stale:

    python scripts/generate-checks.py            # ../sloptic-main alongside this repo
    python scripts/generate-checks.py --grader /path/to/sloptic-main
"""
from __future__ import annotations

import argparse
import inspect
import json
import pathlib
import sys
from collections import defaultdict

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "web" / "lib" / "checks.generated.ts"


def pinned_version() -> str | None:
    """The grader version worker/pyproject.toml pins, which is the one the product runs."""
    import tomllib
    try:
        data = tomllib.loads((HERE.parent / "worker" / "pyproject.toml").read_text())
    except (OSError, ValueError):
        return None
    for dep in data.get("project", {}).get("dependencies", []):
        if dep.replace(" ", "").startswith("sloptic=="):
            return dep.split("==", 1)[1].strip().strip('"')
    return None


def installed_version(checkout: str | None) -> str | None:
    """What we are about to generate FROM. A checkout states its version in its own pyproject; an
    installed wheel states it in its metadata."""
    if checkout:
        import tomllib
        try:
            data = tomllib.loads((pathlib.Path(checkout) / "pyproject.toml").read_text())
            return str(data.get("project", {}).get("version") or "") or None
        except (OSError, ValueError):
            return None
    import importlib.metadata as md
    try:
        return md.version("sloptic")
    except md.PackageNotFoundError:
        return None


def pricing_of(p, predicates) -> dict:
    """How the grader prices this probe when it fires, in the order sloptic.pipeline._run_probe resolves
    it: an off-score diagnostic first, then the severity block, then a measured override, then the
    nominal penalty."""
    spec = p.probe or {}
    if spec.get("report_only"):
        return {"kind": "off"}
    sev = p.severity
    if sev is not None:
        lo, hi = sev.range
        # _severity_penalty clamps a rung into the range and takes only the highest one matched.
        rungs = sorted({(min(hi, max(lo, e.point)), e.evidence) for e in sev.escalators})
        rungs = [(pt, ev) for pt, ev in rungs if pt > sev.default]
        if not rungs:
            return {"kind": "fixed", "points": sev.default}
        return {"kind": "ladder", "from": sev.default, "to": max(pt for pt, _ in rungs),
                "rungs": [{"evidence": ev, "points": pt} for pt, ev in rungs]}
    pred = spec.get("predicate")
    if pred and "penalty_override" in inspect.getsource(predicates.PREDICATES[pred]):
        return {"kind": "measured", "nominal": p.penalty}
    return {"kind": "fixed", "points": p.penalty}


def probe_fact(p, safety, reportcard, predicates, aggregate) -> dict:
    sev = p.severity
    raised = aggregate._CORROBORATION.get(p.id)
    copy = reportcard._CONTENT.get(p.id)
    return {
        "id": p.id,
        "area": p.bundle,
        "category": p.category,
        "passive": safety.is_passive(p.id),
        "expected": copy[0] if copy else None,
        "pricing": pricing_of(p, predicates),
        "group": p.variant_group_id,
        "raised": {"to": raised[0], "when": sorted(raised[1])} if raised else None,
        "authority": {
            "cvss": sev.cvss_score if sev else None,
            "vrt": (sev.vrt or None) if sev else None,
            "iso": (sev.iso_25010 or None) if sev else None,
            "nielsen": (sev.nielsen or None) if sev else None,
        },
    }


def scoring_facts(probes, predicates, aggregate) -> dict:
    """The constants the methodology page explains, read from the grader rather than restated."""
    lh = next(p for p in probes if (p.probe or {}).get("predicate") == "lighthouse_perf_score")
    return {
        "categoryDecay": aggregate.CATEGORY_DECAY,
        "a11yTiers": dict(predicates._A11Y_TIER),
        "a11yDecay": predicates._A11Y_DECAY,
        "lighthouse": {"id": lh.id, "greenFloor": lh.probe.get("green_floor", 0.90),
                       "scale": lh.probe.get("scale", 1.0)},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grader", default=None,
                    help="path to a sloptic-main checkout; omit to use the installed sloptic")
    args = ap.parse_args()

    # Default to the INSTALLED grader, which since 2.2.0 carries the catalog inside the wheel at
    # sloptic/catalog. That is what the worker actually runs, so generating from it means this file
    # describes the battery that grades people rather than whatever happens to be checked out beside
    # the repo. It also lets CI pin a version instead of cloning a branch in two jobs.
    #
    # --grader still takes a checkout, for working on the grader and the site together.
    if args.grader:
        grader = pathlib.Path(args.grader).resolve()
        if not (grader / "sloptic").is_dir():
            print(f"no grader at {grader}. Pass a checkout path or omit --grader.", file=sys.stderr)
            return 1
        sys.path.insert(0, str(grader))

    try:
        from sloptic import aggregate, reportcard, safety                 # noqa: E402
        from sloptic import probes as predicates                          # noqa: E402
        from sloptic.catalog import default_catalog_dir, load_catalog     # noqa: E402
    except ModuleNotFoundError:
        print(f"sloptic is not importable. `pip install sloptic=={pinned_version()}`, "
              "or pass --grader <checkout>.", file=sys.stderr)
        return 1

    # Generating against whatever happens to be installed is a footgun, and it fired on the first
    # run: a machine with sloptic 1.1.1 sitting in site-packages produced 91 checks instead of 102
    # and reported success. The site would then have published a battery nobody runs. So the version
    # is checked against the worker's pin, which is the grader the product actually uses.
    want = pinned_version()
    got = installed_version(args.grader)
    if want and got and got != want:
        print(f"grader is {got}, but worker/pyproject.toml pins {want}.", file=sys.stderr)
        print(f"  `pip install sloptic=={want}`, or pass --grader <checkout of {want}>.",
              file=sys.stderr)
        return 1
    print(f"  grader:  {got or 'unknown'}")

    # default_catalog_dir prefers the packaged copy and falls back to the checkout's sibling
    # `catalog/`, so this is right in both modes without branching on which one we are in.
    catalog_dir = default_catalog_dir()
    if not catalog_dir.is_dir():
        print(f"no catalog at {catalog_dir}.", file=sys.stderr)
        return 1
    print(f"  catalog: {catalog_dir}")

    probes = load_catalog(catalog_dir)

    # Fail loudly rather than emit numbers that do not add up: safety.py is a hand-kept allow-list,
    # and if it ever stops partitioning the live catalog the site's counts become fiction.
    ids = {p.id for p in probes}
    classified = safety.PASSIVE_PROBES | safety.ACTIVE_PROBES
    if classified != ids or (safety.PASSIVE_PROBES & safety.ACTIVE_PROBES):
        print("safety.py no longer partitions the catalog; refusing to generate.", file=sys.stderr)
        print(f"  unclassified: {sorted(ids - classified)}", file=sys.stderr)
        print(f"  stale ids:    {sorted(classified - ids)}", file=sys.stderr)
        return 1

    # The axes, in the order the grader reports them (sloptic.cli._axis_line), and every bundle the
    # catalog uses must be one of them. Emitted as the Area type rather than typed by hand, because a
    # hand-written union is how 3.0 broke this: accessibility became its own bundle, and a type that
    # still listed three axes would have let the site silently drop a real subtotal.
    known = ("security", "qa", "accessibility", "performance")
    bundles = {p.bundle for p in probes}
    stray = bundles - set(known)
    if stray:
        print(f"the catalog uses bundles this generator does not know: {sorted(stray)}. "
              f"Add them to `known` in axis order, then label them in check-labels.ts.",
              file=sys.stderr)
        return 1
    areas = [a for a in known if a in bundles]

    # The hidden pool is the anti-gaming set: checks a team cannot see, so it cannot teach to them. It is
    # never committed to the grader and so never ships in the wheel, but this file publishes every probe
    # it is handed, so it refuses one rather than trusting that.
    hidden = sorted(p.id for p in probes if p.pool != "public")
    if hidden:
        print(f"refusing to publish hidden-pool probes: {hidden}", file=sys.stderr)
        return 1

    # Sorted by id: CI regenerates this file and fails on any diff, and the catalog's load order is
    # whatever the filesystem walk returns.
    facts = [probe_fact(p, safety, reportcard, predicates, aggregate) for p in sorted(probes, key=lambda x: x.id)]
    scoring = scoring_facts(probes, predicates, aggregate)

    cats: dict[tuple[str, str], list] = defaultdict(list)
    for p in probes:
        cats[(p.bundle, p.category)].append(p.id)

    rows = []
    for (area, slug), members in sorted(cats.items()):
        n = len(members)
        npass = sum(1 for i in members if safety.is_passive(i))
        access = "open" if npass == n else "gated" if npass == 0 else "mixed"
        rows.append({"slug": slug, "area": area, "probes": n, "passive": npass, "access": access})

    # probe id -> its area and kind, for EVERY probe. The grade record names the area only for probes
    # that FIRED, so without this the report cannot say which axis a passing check belonged to, and
    # the live progress line cannot name the check it is running. It was passive-only while active
    # probes never ran on a graded target; now that a verified owner or event runs the full battery,
    # an unnamed active probe is what makes the active phase read as a stalled "running the checks".
    index = ",\n".join(
        f'  "{p.id}": ["{p.bundle}", "{p.category}"]'
        for p in sorted(probes, key=lambda x: x.id)
    )

    passive = len(safety.PASSIVE_PROBES)
    probe_rows = ",\n".join("  " + json.dumps(f, separators=(", ", ": ")) for f in facts)
    scoring_json = json.dumps(scoring, separators=(", ", ": "))
    body = ",\n".join(
        f'  {{ slug: "{r["slug"]}", area: "{r["area"]}", probes: {r["probes"]}, '
        f'passive: {r["passive"]}, access: "{r["access"]}" }}'
        for r in rows
    )

    OUT.write_text(f'''// GENERATED by scripts/generate-checks.py from the sloptic catalog. Do not edit by hand.
// Facts only: which categories exist, how many checks each holds, and which run without
// verification. Human labels live in check-labels.ts.

export type Area = {" | ".join(f'"{a}"' for a in areas)};
/** The axes, in the order the grader reports them. Iterate this rather than listing axes by hand. */
export const AREA_ORDER: Area[] = [{", ".join(f'"{a}"' for a in areas)}];
/** open: every check runs on any URL. gated: every check needs verification. mixed: some of each. */
export type Access = "open" | "gated" | "mixed";

export type CategoryFact = {{
  slug: string;
  area: Area;
  probes: number;
  passive: number;
  access: Access;
}};

export const CATEGORY_FACTS: CategoryFact[] = [
{body},
];

export const TOTALS = {{ total: {len(probes)}, passive: {passive}, active: {len(probes) - passive} }};

/** The grader release these facts came from, which is the one worker/pyproject.toml pins. Links into
 *  the grader repo use its tag, so they show the catalog and docs of the release that grades. */
export const GRADER_VERSION = "{got or want}";

/** How a check is priced, read from its catalog entry the way the grader resolves it at grade time.
 *  off: a diagnostic shown on the report that adds nothing to the score.
 *  fixed: one price whenever it fires.
 *  ladder: charged `from` unless the check proves worse harm, which lifts it to the highest rung whose
 *    evidence it set (rungs never add up), at most `to`.
 *  measured: priced from what was measured (Lighthouse's shortfall, the accessibility rule sum, the share
 *    of dead links, a CVE's own score); `nominal` is the catalog's reference value, not a price. */
export type Pricing =
  | {{ kind: "off" }}
  | {{ kind: "fixed"; points: number }}
  | {{ kind: "ladder"; from: number; to: number; rungs: {{ evidence: string; points: number }}[] }}
  | {{ kind: "measured"; nominal: number }};

export type ProbeFact = {{
  id: string;
  area: Area;
  category: string;
  passive: boolean;
  /** What a clean app does, in the grader's own report-card copy. Null where the grader has none. */
  expected: string | null;
  pricing: Pricing;
  /** Checks sharing a group are one flaw found different ways: only the highest-priced one counts. */
  group: string | null;
  /** A defense-in-depth check re-priced up when a flaw it would have contained fires in the same grade. */
  raised: {{ to: number; when: string[] }} | null;
  authority: {{ cvss: number | null; vrt: string | null; iso: string | null; nielsen: string | null }};
}};

export const PROBE_FACTS: ProbeFact[] = [
{probe_rows},
];

/** The grader's scoring constants. */
export const SCORING = {scoring_json} as const;

/** Probe id -> [area, kind], for every probe in the catalog. Lets a report name the checks that
 *  passed (the grade record lists them by id only) and the live progress line name the check it is
 *  running, active probes included. */
export const PROBE_INDEX: Record<string, [Area, string]> = {{
{index},
}};
''')

    print(f"wrote {OUT.relative_to(HERE.parent)}")
    print(f"  {len(probes)} checks, {passive} passive, {len(rows)} categories")
    for area in areas:
        n = [r for r in rows if r["area"] == area]
        print(f"  {area}: {len(n)} categories, {sum(r['probes'] for r in n)} checks")
    kinds = defaultdict(int)
    for f in facts:
        kinds[f["pricing"]["kind"]] += 1
    print("  pricing: " + ", ".join(f"{k} {n}" for k, n in sorted(kinds.items())))
    mixed = [r["slug"] for r in rows if r["access"] == "mixed"]
    if mixed:
        print(f"  mixed access: {', '.join(mixed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
