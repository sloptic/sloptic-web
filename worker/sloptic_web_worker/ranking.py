"""Place a finished grade on a frozen reference curve.

The ranking logic is the GRADER's (`scripts/benchmark.py:rank`), not ours: it owns the tiebreak keys,
the catastrophe gate, the band names and, importantly, `_guard_mode`, which REFUSES to rank a grade
against a curve built from a different battery. That guard is the CLAUDE.md rule ("a passive grade is
a different measurement, never mix it onto the full-grade percentile") expressed as code, and it
works on our records because the grader's coverage block carries `probes_total` (44 for the passive
battery), which is what it keys on. Verified against a real stored record: the 2026.3 full curve
rejects our passive grades outright.

This module is therefore only plumbing: find the curve, call rank(), and fail SOFT. A missing or
unreadable curve means no percentile, exactly as today. It must never cost a grade: the score is the
product, the percentile is context.
"""

import json
import os
import sys
from pathlib import Path

from . import config

# The passive battery the frozen curve measured. A grade that ran a different count is not
# comparable to it, whatever the catalog happens to hold today.
PASSIVE_BATTERY = 44

_curve_cache: dict | None = None
_curve_tried = False


def _benchmark_module():
    """The grader's benchmark script. It lives in `scripts/`, outside the importable package, so it
    is loaded by path rather than imported. If that ever moves into the package, this collapses to a
    plain import."""
    root = Path(config.CURVE_SCRIPTS_DIR).expanduser()
    if not (root / "benchmark.py").is_file():
        return None
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import benchmark  # noqa: PLC0415  (loaded lazily and by path, on purpose)
    return benchmark


def load_curve() -> dict | None:
    """The passive reference curve, or None when one is not configured/present yet."""
    global _curve_cache, _curve_tried
    if _curve_tried:
        return _curve_cache
    _curve_tried = True
    path = (config.PASSIVE_CURVE_PATH or "").strip()
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path) as fh:
            curve = json.load(fh)
    except (OSError, ValueError):
        return None
    # Fail closed on the one thing that must never be wrong: ranking a passive grade on a full curve
    # would compare two different rulers. An untagged curve is the FULL curve by the grader's own
    # convention, so refuse it here rather than relying on the guard downstream.
    if curve.get("probe_set") != "passive":
        print(f"[rank]  ignoring {path}: probe_set={curve.get('probe_set') or '(untagged, i.e. full)'!r}, "
              f"a passive grade may only rank on a passive curve", flush=True)
        return None
    _curve_cache = curve
    return curve


def rank_passive(record: dict, score) -> dict | None:
    """Rank one passive grade, or None if it cannot be ranked. Never raises."""
    curve = load_curve()
    if curve is None:
        return None

    # The grader's rank() already refuses a cross-mode placement, and load_curve already refuses a
    # curve that is not tagged passive. This is the third check on the same rule, deliberately: the
    # curve measured EXACTLY the 44-probe battery, so a record that ran a different number of probes
    # is a different measurement no matter how close the number looks.
    total = (record.get("coverage") or {}).get("probes_total")
    if total is not None and total != PASSIVE_BATTERY:
        print(f"[rank]  not ranked: this grade ran {total} probes, the curve measured {PASSIVE_BATTERY}",
              flush=True)
        return None
    bench = _benchmark_module()
    if bench is None:
        return None
    try:
        return bench.rank(curve, score, record)
    except ValueError as e:
        # The grader's mode guard, or an ineligible record. Both mean "no percentile", not "no grade".
        print(f"[rank]  not ranked: {e}", flush=True)
        return None
    except Exception as e:  # noqa: BLE001 - a percentile is never worth losing a grade over
        print(f"[rank]  ranking failed: {type(e).__name__}: {e}", flush=True)
        return None
