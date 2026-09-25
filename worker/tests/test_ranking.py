"""Ranking a 3.0 grade on the curves vendored beside the worker, through the ranker vendored with them.

Every other test mocks ranking out, which is right for them and means nothing else here proves the
thing this upgrade most needs: that a record the 3.0 grader produces actually places on 2026.4 and
passive-2026.2 through the benchmark.py released alongside them. A curve and a ranker from different
releases misrank every grade without raising anything, so this runs the real files, not stand-ins.

The records are built with the grader's OWN aggregation functions from real catalog probes, never by
hand. A hand-written record tests a guess at the shape: the first draft of this file passed
`coverage.applied` as a count, rank() iterated it, and the failure was a TypeError about ints rather
than anything to do with rankings.

No database: ranking is pure.
"""
from __future__ import annotations

import json

import pytest
from sloptic import ruler as sruler
from sloptic import safety
from sloptic.aggregate import compute_axis_slop, compute_slop_score, coverage_metrics
from sloptic.catalog import default_catalog_dir, load_catalog
from sloptic.schema import Outcome

from sloptic_web_worker import config, ranking


def _record(battery: str, fired: int = 3, ruler="current", probes: int | None = None) -> dict:
    """A record shaped exactly as the 3.0 grader shapes one, from real probes in the real catalog."""
    catalog = load_catalog(default_catalog_dir())
    probes_run = safety.passive_catalog(catalog) if battery == "passive" else catalog
    if probes is not None:
        probes_run = probes_run[:probes]
    outcomes = [
        Outcome(probe_id=p.id, bundle=p.bundle, category=p.category,
                outcome="slop_detected" if i < fired else "clean",
                penalty=getattr(p, "penalty", 5) or 5, evidence={})
        for i, p in enumerate(probes_run)
    ]
    findings = [{**o.__dict__} for o in outcomes if o.outcome == "slop_detected"]
    return {
        "repo": "https://example.com",
        "deployed": True,
        "slop_score": compute_slop_score(outcomes),
        "axis_slop": compute_axis_slop(outcomes),
        "coverage": coverage_metrics(outcomes),
        "observed_surface": {},
        "platform": {},
        "findings": findings,
        "ruler": sruler.ruler() if ruler == "current" else ruler,
    }


@pytest.fixture(autouse=True)
def _fresh_curves():
    # load_curve caches per battery for the life of the process, which is right in the worker and
    # wrong across tests that change what is configured.
    ranking._curve_cache.clear()
    yield
    ranking._curve_cache.clear()


class TestTheVendoredRuler:
    def test_the_worker_defaults_to_the_curves_beside_it(self):
        # Not to a sloptic-main checkout, which could sit at any commit while the grader is pinned to
        # another. Asserted on the DEFAULT, in a clean process, because the effective value depends
        # on .env: the first draft of this test read config directly and failed on the author's own
        # machine, whose .env still pointed PASSIVE_CURVE_PATH into a sloptic-main clone. That is the
        # hazard in miniature, and the ruler check is what makes it harmless.
        import os
        import subprocess
        import sys

        env = {k: v for k, v in os.environ.items()
               if k not in ("FULL_CURVE_PATH", "PASSIVE_CURVE_PATH", "CURVE_SCRIPTS_DIR")}
        # load_dotenv does not override variables already present, so seed them EMPTY: the config
        # treats an empty value as unset and falls back to the vendored default.
        env |= {"FULL_CURVE_PATH": "", "PASSIVE_CURVE_PATH": "", "CURVE_SCRIPTS_DIR": ""}
        out = subprocess.run(
            [sys.executable, "-c",
             "from sloptic_web_worker import config as c;"
             "print(c.FULL_CURVE_PATH); print(c.PASSIVE_CURVE_PATH); print(c.CURVE_SCRIPTS_DIR)"],
            capture_output=True, text=True, env=env, check=True,
        ).stdout.split()
        assert out[0].endswith("worker/curves/benchmark-curve.json")
        assert out[1].endswith("worker/curves/benchmark-curve-passive.json")
        assert out[2].endswith("worker/curves")

    def test_the_curves_are_the_ruler_the_installed_grader_stamps(self):
        # The pin and the vendored files moving apart is the failure this whole arrangement exists
        # to prevent. If this fails after a grader bump, re-vendor worker/curves from the same tag.
        stamp = sruler.ruler()
        assert ranking.load_curve("full")["version"] == stamp["full"]
        assert ranking.load_curve("passive")["version"] == stamp["passive"]

    def test_the_passive_guard_matches_the_battery_the_grader_ships(self):
        catalog = load_catalog(default_catalog_dir())
        assert len(safety.passive_catalog(catalog)) == ranking.PASSIVE_BATTERY

    def test_each_curve_carries_its_performance_normalization(self):
        # Without it a solo grade on an idle worker ranks about 6.6 Lighthouse points too kind
        # against a population graded four at a time. benchmark.rank applies it itself.
        for battery in ("full", "passive"):
            assert ranking.load_curve(battery).get("perf_norm"), battery


class TestAGradeRanks:
    def test_a_passive_grade_places_on_the_passive_curve(self):
        rec = _record("passive")
        out = ranking.rank_passive(rec, rec["slop_score"])
        assert out is not None
        assert 0 <= out["cleaner_than_pct"] <= 100

    def test_a_full_grade_places_on_the_full_curve(self):
        rec = _record("full")
        out = ranking.rank_full(rec, rec["slop_score"])
        assert out is not None
        assert 0 <= out["cleaner_than_pct"] <= 100

    def test_a_cleaner_grade_places_higher(self):
        # The one property a reader relies on without thinking about it.
        dirty, clean = _record("passive", fired=6), _record("passive", fired=1)
        d = ranking.rank_passive(dirty, dirty["slop_score"])
        c = ranking.rank_passive(clean, clean["slop_score"])
        assert c["cleaner_than_pct"] > d["cleaner_than_pct"]


class TestAGradeIsRefusedAnotherRuler:
    def test_a_grade_with_no_stamp_is_not_ranked(self):
        # It predates the stamp, so it came from a grader older than any curve this build ships.
        rec = _record("passive", ruler=None)
        assert ranking.rank_passive(rec, rec["slop_score"]) is None

    def test_a_grade_stamped_with_the_old_ruler_is_not_ranked(self):
        rec = _record("passive", ruler={"full": "2026.3", "passive": "passive-2026.1"})
        assert ranking.rank_passive(rec, rec["slop_score"]) is None

    def test_a_stale_curve_override_ranks_nothing(self, tmp_path, monkeypatch):
        # The failure the vendored default was built to avoid, reintroduced the one way it still can
        # be: a .env pointing PASSIVE_CURVE_PATH at an older curve. Every grade goes unranked, loudly,
        # rather than misranked, silently.
        old = ranking.load_curve("passive") | {"version": "passive-2026.1"}
        path = tmp_path / "old-passive.json"
        path.write_text(json.dumps(old))
        monkeypatch.setattr(config, "PASSIVE_CURVE_PATH", str(path))
        ranking._curve_cache.clear()
        rec = _record("passive")
        assert ranking.rank_passive(rec, rec["slop_score"]) is None

    def test_a_passive_grade_that_ran_a_different_battery_is_not_ranked(self):
        rec = _record("passive", probes=44)
        assert ranking.rank_passive(rec, rec["slop_score"]) is None

    def test_the_curves_are_never_crossed(self):
        # benchmark.rank refuses a cross-mode placement and load_curve refuses a mistagged file.
        assert ranking._load(config.FULL_CURVE_PATH, "passive") is None
        assert ranking._load(config.PASSIVE_CURVE_PATH, "full") is None
