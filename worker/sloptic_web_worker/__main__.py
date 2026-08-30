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


class _Reputation:
    """The two IP-reputation controls, kept together because they answer the same question: may the
    worker grade anything right now?

    The worker grades from a residential IP deliberately, and that IP is a shared, slow-to-recover
    asset. `scripts/retry_blocked.py` in the grader repo documents the economics: a per-app Vercel
    challenge clears in ~10 minutes, but an IP-LEVEL flag re-challenges every app at entry, lasts a
    day or two, and EVERY retry re-warms it and resets its decay. So the correct response to an
    entry challenge is to stop grading entirely and let the flag fade, never to retry.
    """

    def __init__(self) -> None:
        self.paused_until = 0.0
        self.pause_reason = ""

    def trip(self, reason: str) -> None:
        self.paused_until = time.time() + config.CHALLENGE_BACKOFF_SECONDS
        self.pause_reason = reason
        hours = config.CHALLENGE_BACKOFF_SECONDS / 3600
        print(f"[breaker] tripped: {reason}. Not claiming for {hours:.0f}h so the flag can decay.",
              flush=True)

    def blocked(self, conn) -> str:
        """Why the worker may not claim right now, or '' if it may."""
        if time.time() < self.paused_until:
            left = (self.paused_until - time.time()) / 3600
            return f"challenge backoff, {left:.1f}h left ({self.pause_reason})"
        if self.paused_until:                       # the pause just expired
            print("[breaker] backoff elapsed; resuming.", flush=True)
            self.paused_until = 0.0
        used = db.grades_in_last_day(conn)
        if used >= config.DAILY_GRADE_BUDGET:
            return f"daily budget spent ({used}/{config.DAILY_GRADE_BUDGET} in 24h)"
        return ""


def process_one(conn, rep: "_Reputation") -> bool:
    """Claim and process a single job. Returns False if nothing was done."""
    halted = rep.blocked(conn)
    if halted:
        return False

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
        # An ENTRY challenge means nothing was graded and the IP itself is likely flagged; a LATE one
        # means this app challenged us after a full run, which is that app's business, not the IP's.
        if result.get("challenge_stage") == "entry":
            rep.trip(f"entry challenge grading {job.origin}")
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
          f"egress_ready={config.EGRESS_SANDBOX_READY}, "
          f"budget={config.DAILY_GRADE_BUDGET}/day)", flush=True)
    conn = db.connect()
    rep = _Reputation()
    last_reap = 0.0
    last_halt = ""
    while True:
        try:
            # Reclaim jobs a killed worker abandoned. Cheap, and only worth doing occasionally.
            if time.time() - last_reap > 60:
                last_reap = time.time()
                n = db.reap_stale_jobs(conn)
                if n:
                    print(f"[reap]  returned or failed {n} stale job(s)", flush=True)

            # Say WHY we are idle, but only when the reason changes: this loop runs every 5s.
            halted = rep.blocked(conn)
            if halted != last_halt:
                if halted:
                    print(f"[hold]  not claiming: {halted}", flush=True)
                last_halt = halted

            worked = process_one(conn, rep)
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
