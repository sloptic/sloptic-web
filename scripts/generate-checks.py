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
        from sloptic import safety                                        # noqa: E402
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
    body = ",\n".join(
        f'  {{ slug: "{r["slug"]}", area: "{r["area"]}", probes: {r["probes"]}, '
        f'passive: {r["passive"]}, access: "{r["access"]}" }}'
        for r in rows
    )

    OUT.write_text(f'''// GENERATED by scripts/generate-checks.py from the sloptic catalog. Do not edit by hand.
// Facts only: which categories exist, how many checks each holds, and which run without
// verification. Human labels live in check-labels.ts.

export type Area = "security" | "qa" | "performance";
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

/** Probe id -> [area, kind], for every probe in the catalog. Lets a report name the checks that
 *  passed (the grade record lists them by id only) and the live progress line name the check it is
 *  running, active probes included. */
export const PROBE_INDEX: Record<string, [Area, string]> = {{
{index},
}};
''')

    print(f"wrote {OUT.relative_to(HERE.parent)}")
    print(f"  {len(probes)} checks, {passive} passive, {len(rows)} categories")
    for area in ("security", "qa", "performance"):
        n = [r for r in rows if r["area"] == area]
        print(f"  {area}: {len(n)} categories, {sum(r['probes'] for r in n)} checks")
    mixed = [r["slug"] for r in rows if r["access"] == "mixed"]
    if mixed:
        print(f"  mixed access: {', '.join(mixed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
