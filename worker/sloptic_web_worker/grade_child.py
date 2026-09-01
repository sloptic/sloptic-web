"""Grade exactly one already-claimed job, in a process of its own.

    python -m sloptic_web_worker.grade_child <job-id>

Why a separate process rather than a thread or an in-loop call. A grade can WEDGE: a Playwright sync
call against a CPU-spun renderer holds the GIL, so the grade cannot time itself out, cooperative
cancellation never runs, and even a signal handler does not get scheduled. The only thing that ends
it is an external SIGKILL of the process group, which also takes the headless Chrome it spawned.
sloptic's own corpus runners settled on exactly this shape (scripts/run_batch.py), and this is that
lesson applied to the web worker.

Being processes buys the second thing too: sloptic serializes the Lighthouse trace lane with a
counting semaphore over flock files, which is cross-process by construction and would not reach
across threads.

The child owns its own database connection and writes its own outcome, so a supervisor that dies
mid-grade cannot lose a finished result. The exit code carries back only what the supervisor needs
that the row does not already say: whether the target challenged us at entry, which is the input to
the IP-reputation breaker.
"""

import os
import sys
import time
from urllib.parse import urlparse

from . import config, db
from .egress import EgressNotReady, guard_target, install as install_egress
from .grader import Unreachable, run_passive_grade

def _host_of(origin: str) -> str:
    return (urlparse(origin).hostname or "").lower()


EXIT_OK = 0                 # graded, and we reached the app
EXIT_ENTRY_CHALLENGE = 10   # graded, but the target challenged us before anything was measured
EXIT_FAILED = 20            # did not grade; the child has already written the reason to the row


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m sloptic_web_worker.grade_child <job-id>", file=sys.stderr)
        return 2
    job_id = argv[1]

    # Must happen before the first outbound connection of any kind. pipeline.run() installs it too,
    # so a grade is covered either way; this covers anything this process does outside one.
    install_egress()

    # Point sloptic's cross-process Lighthouse throttle at a shared path. Set here, in the process
    # that actually traces, so it cannot be lost between the supervisor and the grade.
    os.environ.setdefault("SLOPTIC_LIGHTHOUSE_LOCK", config.LIGHTHOUSE_LOCK_PATH)
    os.environ.setdefault("SLOPTIC_LIGHTHOUSE_SLOTS", config.LIGHTHOUSE_SLOTS)

    conn = db.connect()
    job = db.get_job(conn, job_id)
    if job is None:
        print(f"[child] {job_id}: no such job", flush=True)
        return EXIT_FAILED

    try:
        if job.mode != "passive":
            raise ValueError(f"unsupported mode {job.mode!r} (v1 is passive only)")

        # P0 safety gate. Fails closed until the egress sandbox is enabled.
        guard_target(job.origin, _host_of(job.origin))

        # Throttle: on_progress fires twice per probe, so an unthrottled write would be ~90 UPDATEs a
        # grade for a field nothing queries. A PHASE change always gets through, since that is the
        # part that explains a long silence.
        last = {"at": 0.0, "phase": None}

        def _progress(p: dict) -> None:
            now = time.time()
            if p.get("phase") != last["phase"] or now - last["at"] > 2.0:
                last["at"], last["phase"] = now, p.get("phase")
                p["at"] = now
                db.save_progress(conn, job.id, p)

        result = run_passive_grade(job.origin, progress_cb=_progress)
        db.save_result(conn, job.id, result)
        print(f"[done]  {job.id} slop={result['slop_score']} axes={result['axis_slop']}", flush=True)
        return EXIT_ENTRY_CHALLENGE if result.get("challenge_stage") == "entry" else EXIT_OK
    except EgressNotReady as e:
        db.mark_failed(conn, job.id, str(e))
        print(f"[blocked] {job.id}: {e}", flush=True)
    except Unreachable as e:
        db.mark_failed(conn, job.id, f"target not gradeable: {e}")
        print(f"[fail]  {job.id}: unreachable: {e}", flush=True)
    except Exception as e:  # noqa: BLE001 — the child dies with the job, never silently
        db.mark_failed(conn, job.id, f"worker error: {e}")
        print(f"[error] {job.id}: {e}", flush=True)
    finally:
        db.save_progress(conn, job.id, None)
    return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main(sys.argv))
