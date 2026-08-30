"""Worker entry point: python -m sloptic_web_worker

Loop: claim the oldest queued grade -> egress-guard the target -> run the passive grade -> persist.
An empty queue sleeps POLL_INTERVAL_SECONDS. Any grade error fails just that job; the loop never dies.
"""

import time
from urllib.parse import urlparse

from . import config, db
from .egress import EgressNotReady, guard_target, install as install_egress
from .grader import Unreachable, run_passive_grade


def _host_of(origin: str) -> str:
    return (urlparse(origin).hostname or "").lower()


def process_one(conn) -> bool:
    """Claim and process a single job. Returns False if the queue was empty."""
    job = db.claim_job(conn)
    if job is None:
        return False

    print(f"[claim] {job.id} {job.origin} (mode={job.mode})", flush=True)
    try:
        # v1 grades passive only; an active job should never reach this worker yet.
        if job.mode != "passive":
            raise ValueError(f"unsupported mode {job.mode!r} (v1 is passive only)")

        # P0 safety gate. Fails closed until the egress sandbox is implemented and enabled.
        guard_target(job.origin, _host_of(job.origin))

        result = run_passive_grade(job.origin)
        db.save_result(conn, job.id, result)
        print(f"[done]  {job.id} slop={result['slop_score']} axes={result['axis_slop']}", flush=True)
    except EgressNotReady as e:
        db.mark_failed(conn, job.id, str(e))
        print(f"[blocked] {job.id}: {e}", flush=True)
    except Unreachable as e:
        db.mark_failed(conn, job.id, f"target not gradeable: {e}")
        print(f"[fail]  {job.id}: unreachable: {e}", flush=True)
    except Exception as e:  # noqa: BLE001 — one bad grade must not kill the worker
        db.mark_failed(conn, job.id, f"worker error: {e}")
        print(f"[error] {job.id}: {e}", flush=True)
    return True


def main() -> None:
    # The grader's resolver guard is opt-in as of sloptic 2.1.0. pipeline.run() installs it, so every
    # grade is covered regardless; installing here too covers anything this process does OUTSIDE a
    # grade. Idempotent, and it must happen before the first outbound connection of any kind.
    install_egress()
    print(f"sloptic-web worker starting (poll={config.POLL_INTERVAL_SECONDS}s, "
          f"egress_ready={config.EGRESS_SANDBOX_READY})", flush=True)
    conn = db.connect()
    while True:
        try:
            worked = process_one(conn)
        except Exception as e:  # connection dropped, etc. — reconnect and keep going
            print(f"[loop] error: {e}; reconnecting", flush=True)
            time.sleep(config.POLL_INTERVAL_SECONDS)
            try:
                conn = db.connect()
            except Exception:
                pass
            continue
        if not worked:
            time.sleep(config.POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
