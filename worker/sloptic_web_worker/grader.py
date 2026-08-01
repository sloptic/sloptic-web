"""Adapter over the pinned sloptic grader. Runs the PASSIVE subset against a live URL and returns a
record shaped like shared/contract.md. This is the only module that imports sloptic; probe logic is
never reimplemented here.
"""

from importlib.metadata import PackageNotFoundError, version

from sloptic import browser, safety
from sloptic.catalog import load_catalog
from sloptic.cli import _grade_record
from sloptic.deploy import RemoteDeployer
from sloptic.pipeline import run

from . import config

# Deploy failures the pipeline can raise for an unreachable / non-web target -> a clean "failed" grade.
DEPLOY_FAILURES = (RuntimeError, TimeoutError, OSError)

_passive_catalog = None


def _catalog_version() -> str:
    try:
        return f"sloptic-{version('sloptic')}"
    except PackageNotFoundError:
        return "sloptic-unknown"


def passive_catalog():
    """Load and cache the passive-only catalog once. Fail-closed classification lives in sloptic.safety."""
    global _passive_catalog
    if _passive_catalog is None:
        _passive_catalog = safety.passive_catalog(load_catalog(config.CATALOG_DIR))
    return _passive_catalog


class Unreachable(Exception):
    """The target did not present a gradeable surface."""


def run_passive_grade(origin: str) -> dict:
    """Grade `origin` with the passive battery. Raises Unreachable if the target cannot be reached.

    render_routes turns on the browser so the passive a11y and Core Web Vitals probes can run.
    """
    catalog = passive_catalog()
    try:
        report = run(RemoteDeployer(origin), catalog, render=browser.render_routes)
    except DEPLOY_FAILURES as e:
        raise Unreachable(str(e)[:500]) from e

    # _grade_record gives the benchmark-rankable shape (repo, slop_score, axis_slop, coverage,
    # observed_surface, platform, findings). Re-key to the web contract and tag it as a passive subset.
    record = _grade_record(report, origin)
    return {
        "mode": "passive",
        "catalog_version": _catalog_version(),
        "passive_probe_count": len(catalog),
        "slop_score": record["slop_score"],
        "axis_slop": record["axis_slop"],
        "coverage": record.get("coverage") or {},
        "platform": record.get("platform") or {},
        "surface": record.get("observed_surface") or {},
        "findings": record.get("findings") or [],
    }
