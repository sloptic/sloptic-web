"""Adapter over the pinned sloptic grader. Runs the PASSIVE subset against a live URL and returns a
record shaped like shared/contract.md. This is the only module that imports sloptic; probe logic is
never reimplemented here.
"""

from importlib.metadata import PackageNotFoundError, version

from dataclasses import asdict

from sloptic import browser, egress, lighthouse, reportcard, safety
from sloptic.aggregate import compute_axis_slop, compute_slop_score
from sloptic.catalog import load_catalog
from sloptic.cli import _grade_record
from sloptic.deploy import RemoteDeployer
from sloptic.pipeline import run
from sloptic.schema import Outcome

from . import config, ranking

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


def _build_card(record: dict, origin: str) -> dict:
    """The grader's own report card: per finding, what was expected, what was seen, what it means, and
    the remediation. Passing `catalog_root` keeps the public/hidden pool split honest."""
    try:
        return reportcard.build_card({**record, "url": origin}, config.CATALOG_DIR)
    except Exception as e:  # noqa: BLE001 - a card is a nicety; never lose a grade over one
        return {"error": f"card unavailable: {e}"}


def _axis_potential(report) -> dict:
    """Per axis, the damped score this app would carry if every check that APPLIED had fired.

    The penalties must come from the CATALOG, not from the run: a check that passed records penalty 0,
    so flipping its verdict would score nothing and the potential would collapse to equal the real
    score. This mirrors what scripts/benchmark.py does when it reconstructs the worst case, and it uses
    the grader's aggregator so the dampers (a variant group fires once, repeats within a category
    decay) match the real score exactly. Always >= axis_slop.
    """
    catalog = {p.id: p for p in load_catalog(config.CATALOG_DIR)}
    applied = (report.coverage or {}).get("applied") or []

    by_bundle: dict[str, list] = {}
    for pid in applied:
        probe = catalog.get(pid)
        if probe is None:                    # in the record but not this catalog: skip, do not guess
            continue
        by_bundle.setdefault(probe.bundle, []).append(
            Outcome(probe_id=pid, bundle=probe.bundle, category=probe.category,
                    outcome="slop_detected", penalty=probe.penalty,
                    variant_group_id=probe.variant_group_id)
        )
    return {bundle: compute_slop_score(outs) for bundle, outs in by_bundle.items()}


def _email_receiver():
    """The email-verification probes' inbox, or None so they read N/A. Both halves are required, the
    address suffix and the endpoint to poll, exactly as the CLI requires them."""
    if not (config.EMAIL_DOMAIN and config.EMAIL_ENDPOINT):
        return None
    try:
        from sloptic.email_verify import HttpReceiver
        return HttpReceiver(domain=config.EMAIL_DOMAIN, endpoint=config.EMAIL_ENDPOINT,
                            token=config.EMAIL_TOKEN or "")
    except Exception as e:  # noqa: BLE001 - an inbox is never worth losing a grade over
        print(f"[grade] email receiver unavailable: {type(e).__name__}: {e}", flush=True)
        return None


def _run_grade(origin: str, catalog, mode: str, progress_cb=None, only_probes=None) -> dict:
    """Grade `origin` with `catalog`. Raises Unreachable if the target cannot be reached.

    render_routes turns on the browser so the a11y and Core Web Vitals probes can run.

    `only_probes` narrows the catalog to those ids, which is how a retry pass re-runs just the tail a
    WAF challenged. Same mechanism as the CLI's --probe.
    """
    if only_probes:
        wanted = set(only_probes)
        catalog = [p for p in catalog if p.id in wanted]
    try:
        # origin_scope pins every resolution in this grade to the submitted scheme+host+port, so a
        # redirect cannot carry the grade off the origin the submitter named -- not even to another
        # public host. The corpus lane deliberately runs UNSCOPED (its behavior must stay identical
        # to the frozen curve); a public grade for a stranger is exactly where scoping belongs.
        # The grader reports its own progress; we only forward it. on_progress fires twice per probe
        # (before with outcomes=None, after with its outcomes), on_phase at each boundary with
        # important=True for a long silent stretch, which in practice means Lighthouse.
        state = {"phase": "starting", "label": "", "done": 0, "total": len(catalog), "probe": ""}

        def _emit():
            if progress_cb:
                progress_cb(dict(state))

        def _on_progress(done, total, probe, outcomes):
            state.update(done=done, total=total,
                         probe=getattr(probe, "id", "") or "")
            if outcomes is None:            # starting this probe: the useful moment to display
                _emit()

        def _on_phase(name, label, important=False):
            state.update(phase=name or "", label=label or "")
            if name == "lighthouse":
                lh["run"] = 0          # a fresh count per grade, not per process
            _emit()

        # Lighthouse is the long silent stretch, and it reports nothing while it runs: run_local
        # shells the CLI with --quiet under subprocess.run(capture_output=True), so nothing is
        # readable until the process exits. But measure() calls run_local once PER RUN (three by
        # default), so wrapping that function turns an opaque three-minute block into "run 2 of 3".
        # This wraps rather than replaces, restores in a finally, and is the same seam the grader's
        # own test suite patches. If the attribute ever moves, the except below leaves progress
        # coarser and the grade untouched.
        lh = {"run": 0}
        real_run_local = getattr(lighthouse, "run_local", None)

        def _counting_run_local(url, **kw):
            lh["run"] += 1
            state.update(phase="lighthouse",
                         label=f"performance run {lh['run']} of {getattr(lighthouse, 'DEFAULT_RUNS', 3)}")
            _emit()
            return real_run_local(url, **kw)

        try:
            if real_run_local is not None:
                lighthouse.run_local = _counting_run_local
            with egress.origin_scope(origin):
                # The authenticated lane, active only. browser_register self-registers a throwaway
                # account; auth_crawl carries that session into discovery so an SPA's behind-login
                # surface is mapped and the upload/CRUD/IDOR probes have something to aim at.
                # Passive never gets either: it must stay a read-only look at the public surface.
                extra = {}
                if mode == "active" and config.ACTIVE_BROWSER_AUTH:
                    extra["browser_register"] = browser.register_in_browser
                    extra["auth_crawl"] = True
                if mode == "active":
                    extra["email_receiver"] = _email_receiver()

                report = run(RemoteDeployer(origin), catalog, render=browser.render_routes,
                             on_progress=_on_progress, on_phase=_on_phase, **extra)
        finally:
            if real_run_local is not None:
                lighthouse.run_local = real_run_local
    except DEPLOY_FAILURES as e:
        raise Unreachable(str(e)[:500]) from e

    # _grade_record gives the benchmark-rankable shape (repo, slop_score, axis_slop, coverage,
    # observed_surface, platform, findings). Re-key to the web contract and tag it as a passive subset.
    record = _grade_record(report, origin)

    # The record above is the benchmark-rankable shape: it keeps only the checks that FIRED, because
    # ranking does not care what passed. A report does. Everything below comes from the grader's own
    # public API, so none of the scoring or wording is re-derived here.
    # Percentile against the frozen PASSIVE curve, if one is configured. Returns None otherwise, and
    # never raises: the score is the product, the rank is context.
    # Percentile against the frozen curve FOR THIS BATTERY. The two are never interchangeable, and
    # the grader's own guard refuses a cross-mode placement even if this picked the wrong one.
    if mode == "active":
        rank = ranking.rank_full(record, record["slop_score"])
        curve = ranking.load_curve("full")
    else:
        rank = ranking.rank_passive(record, record["slop_score"])
        curve = ranking.load_curve("passive")
    if rank is not None:
        rank["curve_version"] = (curve or {}).get("version")

    card = _build_card(record, origin)
    outcomes = [asdict(o) for o in report.outcomes]
    axis_potential = _axis_potential(report)

    return {
        # The WAF/bot-challenge signal, carried up so the worker's circuit breaker can act on it.
        # `challenge_stage == "entry"` means we were challenged on the FIRST fetch: nothing was
        # graded, and per scripts/retry_blocked.py an IP-level flag re-challenges every app at entry
        # and every retry re-warms it. That is a stop signal for the whole worker, not one job.
        # Probes a challenge stopped from running at all. Carried up so the worker can recover them
        # on a later pass: read as N/A they would be lost recall dressed as a clean result.
        "blocked_probes": list(record.get("blocked_probes") or []),
        "incomplete_axes": list(record.get("incomplete_axes") or []),
        "bot_challenge": bool(record.get("bot_challenge")),
        "challenge_stage": record.get("challenge_stage") or "",
        "card": card,
        "outcomes": outcomes,
        "axis_potential": axis_potential,
        "ranking": rank,
        "mode": mode,
        "catalog_version": _catalog_version(),
        "passive_probe_count": len(catalog),
        "slop_score": record["slop_score"],
        "axis_slop": record["axis_slop"],
        "coverage": record.get("coverage") or {},
        "platform": record.get("platform") or {},
        "surface": record.get("observed_surface") or {},
        "findings": record.get("findings") or [],
    }


def run_passive_grade(origin: str, progress_cb=None) -> dict:
    """The 44 check floor any URL gets."""
    return _run_grade(origin, passive_catalog(), "passive", progress_cb)


def run_active_grade(origin: str, progress_cb=None, only_probes=None) -> dict:
    """The full battery, which SENDS ATTACK TRAFFIC.

    Only ever called for a target the requesting account has proven it may test: the caller checks
    that, and grade_child checks it again immediately before this runs. Nothing in this function
    verifies authorization, so nothing should call it without having done so.
    """
    return _run_grade(origin, load_catalog(config.CATALOG_DIR), "active", progress_cb, only_probes)


def merge_retry(stored: dict, retry: dict, retried_ids: list) -> dict:
    """Fold a retry pass's outcomes into a stored result and re-score it.

    Only the probes that were actually re-run are replaced. Everything else in the stored result
    stands, because the retry ran a narrowed catalog and knows nothing about the rest.

    The score is recomputed with the grader's OWN aggregate functions rather than adjusted here:
    slop is damped across variant groups and categories, so a recovered finding does not simply add
    its penalty, and any arithmetic done locally would drift from the real ruler the moment the
    dampers changed.
    """
    from sloptic.schema import Outcome

    retried = set(retried_ids)
    kept = [o for o in (stored.get("outcomes") or []) if o.get("probe_id") not in retried]
    merged_dicts = kept + list(retry.get("outcomes") or [])

    # Rehydrate for the grader's aggregates. A dict that will not become an Outcome is a shape we do
    # not understand, and silently dropping it would quietly lower the score.
    outs = []
    for d in merged_dicts:
        try:
            outs.append(Outcome(**d))
        except TypeError as e:
            raise ValueError(f"cannot rehydrate outcome {d.get('probe_id')!r}: {e}") from e

    still_blocked = sorted(set(retry.get("blocked_probes") or []) & retried)
    merged = dict(stored)
    merged["outcomes"] = merged_dicts
    merged["slop_score"] = compute_slop_score(outs)
    merged["axis_slop"] = compute_axis_slop(outs)
    merged["blocked_probes"] = still_blocked
    merged["incomplete_axes"] = sorted(
        {o.bundle for o in outs if o.probe_id in still_blocked and getattr(o, "bundle", None)}
    )
    # Findings are the fired outcomes, which the retry may have changed either way.
    merged["findings"] = [
        f for f in (stored.get("findings") or []) if f.get("probe_id") not in retried
    ] + list(retry.get("findings") or [])
    return merged
