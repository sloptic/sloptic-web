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

_curve_cache: dict[str, dict | None] = {}


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


def _load(path: str, want: str) -> dict | None:
    """A frozen curve from `path`, but only if it was built from the battery named by `want`.

    The tag check is the load-bearing part and it fails closed both ways. An untagged curve is the
    FULL curve by the grader's own convention, so it is accepted only when the full one is wanted.
    Ranking a passive grade on the full curve, or the reverse, compares two different rulers.
    """
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path) as fh:
            curve = json.load(fh)
    except (OSError, ValueError):
        return None
    tag = curve.get("probe_set") or "full"
    if tag != want:
        print(f"[rank]  refusing {path}: it is the {tag!r} curve, wanted {want!r}", flush=True)
        return None
    return curve


def load_curve(battery: str = "passive") -> dict | None:
    """The reference curve for a battery, or None when one is not configured yet."""
    if battery in _curve_cache:
        return _curve_cache[battery]
    path = (config.PASSIVE_CURVE_PATH if battery == "passive" else config.FULL_CURVE_PATH) or ""
    curve = _load(path.strip(), "passive" if battery == "passive" else "full")
    _curve_cache[battery] = curve
    return curve


def rank_passive(record: dict, score) -> dict | None:
    """Rank one passive grade, or None if it cannot be ranked. Never raises."""
    curve = load_curve(battery)
    if curve is None:
        return None

    # The grader's rank() already refuses a cross-mode placement, and load_curve already refuses a
    # curve that is not tagged passive. This is the third check on the same rule, deliberately: the
    # curve measured EXACTLY the 44-probe battery, so a record that ran a different number of probes
    # is a different measurement no matter how close the number looks.
    total = (record.get("coverage") or {}).get("probes_total")
    if expect_probes is not None and total is not None and total != expect_probes:
        print(f"[rank]  not ranked: this grade ran {total} probes, the curve measured {expect_probes}",
              flush=True)
        return None
    bench = _benchmark_module()
    if bench is None:
        return None
    try:
        ranked = bench.rank(curve, score, record)
    except ValueError as e:
        # The grader's mode guard, or an ineligible record. Both mean "no percentile", not "no grade".
        print(f"[rank]  not ranked: {e}", flush=True)
        return None
    except Exception as e:  # noqa: BLE001 - a percentile is never worth losing a grade over
        print(f"[rank]  ranking failed: {type(e).__name__}: {e}", flush=True)
        return None

    # Whether a gating finding fired, asked of the grader rather than decided here. An event board
    # has to keep such an app out of its top rows however low the score is, and the category list
    # that defines "gating" belongs to benchmark.py. Prefer a public name if one ever appears.
    gate = getattr(bench, "has_catastrophe", None) or getattr(bench, "_has_catastrophe", None)
    is_gate = getattr(bench, "is_gate", None) or getattr(bench, "_is_gate", None)
    if ranked is not None and gate is not None:
        try:
            ranked["has_catastrophe"] = bool(gate(record))
            # The COUNT as well as the fact. An event board shows how many an entry carries, and one
            # leaked key reads differently from four. Same predicate, applied per finding.
            # The weakest-link tiebreak's input. A board that claims to break ties on the worst
            # single finding needs the number, and deriving it from findings on the page would mean
            # every board pulling every finding of every entry.
            ranked["max_penalty"] = max(
                (f.get("penalty") or 0 for f in (record.get("findings") or [])), default=0
            )
            if is_gate is not None:
                ranked["catastrophe_findings"] = sum(
                    1 for f in (record.get("findings") or []) if is_gate(f)
                )
        except Exception:  # noqa: BLE001 - a flag is never worth losing a grade over
            pass
    return ranked


def rank_passive(record: dict, score: float) -> dict | None:
    """Place a passive grade on passive-2026.1."""
    return _rank(record, score, "passive", PASSIVE_BATTERY)


def rank_full(record: dict, score: float) -> dict | None:
    """Place a full grade on 2026.3.

    No probe-count guard, unlike the passive side. The full battery's applicable count varies with
    what the app exposes, which is the whole point of coverage; the passive battery is a fixed 44, so
    a different number there means a different measurement. The grader's own `_guard_mode` still
    refuses a cross-mode placement either way.
    """
    return _rank(record, score, "full", None)
