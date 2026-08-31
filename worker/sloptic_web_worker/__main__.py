"""Worker entry point: python -m sloptic_web_worker

Loop: claim the oldest queued grade -> egress-guard the target -> run the passive grade -> persist.
An empty queue sleeps POLL_INTERVAL_SECONDS. Any grade error fails just that job; the loop never dies.
"""

import threading
import time
from urllib.parse import urlparse

from . import config, db
from .egress import EgressNotReady, guard_target, install as install_egress
from .grader import Unreachable, run_passive_grade


def _host_of(origin: str) -> str:
    return (urlparse(origin).hostname or "").lower()


class _Heartbeat:
    """Write liveness on a timer, from its OWN thread and OWN connection.

    It cannot live in the main loop: `process_one` blocks for the whole grade (~7 minutes with three
    Lighthouse runs), so a loop-driven heartbeat goes silent for exactly as long as the worker is
    busiest, and the site then reports that nothing is running while a grade is in flight. Observed
    live: heartbeat 143s old with a job 165s into grading.

    A separate psycopg connection because connections are not safe to share across threads.
    """

    INTERVAL = 15.0            # well inside the reader's 90s staleness window

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = ("polling", "", None)     # state, reason, in_flight
        self._stop = threading.Event()

    def set(self, state: str, reason: str = "", in_flight: str | None = None) -> None:
        with self._lock:
            self._state = (state, reason, in_flight)

    def _run(self) -> None:
        conn = None
        while not self._stop.is_set():
            try:
                if conn is None or conn.closed:
                    conn = db.connect()
                with self._lock:
                    state, reason, in_flight = self._state
                db.heartbeat(conn, state, reason, in_flight)
            except Exception as e:  # noqa: BLE001 - liveness reporting must never kill the worker
                print(f"[beat]  heartbeat failed: {type(e).__name__}: {e}", flush=True)
                conn = None
            self._stop.wait(self.INTERVAL)

    def start(self) -> None:
        threading.Thread(target=self._run, daemon=True, name="heartbeat").start()


class _Reputation:
    """The two IP-reputation controls, kept together because they answer the same question: may the
    worker grade anything right now?

    Two corrections worth carrying, both from reading scripts/retry_blocked.py rather than assuming:

    1. A challenge is usually about CLIENT BEHAVIOR, not our IP. That tool proves it: run_batch and
       the retry share a client and an IP, and curl 200s that same IP throughout; the only
       difference is that run_batch fires ~40 benign probes before its attack tail while the bare
       retry is attack-from-probe-#1. Hence its benign padding, at roughly 3:1 benign to attack.
       This matters here because the web worker runs the PASSIVE battery only, which is benign by
       construction, so it looks like the padding rather than the tail and should rarely be
       challenged at all.
    2. A real IP-level flag is INTERMITTENT, not a clean cliff: that tool relaxed its threshold from
       8 to 25 consecutive zero-recovery entry challenges after seeing three late successes right
       after a nine-challenge cluster. A low bar throws away a run that would still recover.

    So this breaker exists for one narrow case: a long sustained streak of grades that never reach
    their app. Anything shorter is somebody's WAF, not our standing, and stopping for it would cost
    real grades for no benefit. Any grade that reaches its app clears the streak.
    """

    def __init__(self) -> None:
        self.paused_until = 0.0
        self.pause_reason = ""
        self.entry_streak = 0        # consecutive grades that never reached their app

    def observe(self, origin: str, stage: str) -> None:
        """Record how a finished grade ended, and trip only on a long sustained dead streak.

        Unreachable targets never get here (they fail before a grade completes), so a run of dead
        URLs cannot trip this, matching retry_blocked's rule that only WAF verdicts count.
        """
        if not config.CHALLENGE_TRIP_STREAK:
            return
        if stage != "entry":
            if self.entry_streak:
                print(f"[breaker] reached {origin}; streak reset from {self.entry_streak}", flush=True)
            self.entry_streak = 0
            return
        self.entry_streak += 1
        if self.entry_streak >= config.CHALLENGE_TRIP_STREAK:
            self.trip(f"{self.entry_streak} consecutive grades challenged at entry")
        else:
            print(f"[breaker] entry challenge {self.entry_streak}/{config.CHALLENGE_TRIP_STREAK} "
                  f"({origin}); one app's WAF is not our standing, continuing", flush=True)

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


def process_one(conn, rep: "_Reputation", beat: "_Heartbeat") -> bool:
    """Claim and process a single job. Returns False if nothing was done."""
    halted = rep.blocked(conn)
    if halted:
        return False

    job = db.claim_job(conn)
    if job is None:
        return False

    print(f"[claim] {job.id} {job.origin} (mode={job.mode})", flush=True)
    beat.set("polling", "", job.id)          # the timer thread keeps writing this for the whole grade
    try:
        # v1 grades passive only; an active job should never reach this worker yet.
        if job.mode != "passive":
            raise ValueError(f"unsupported mode {job.mode!r} (v1 is passive only)")

        # P0 safety gate. Fails closed until the egress sandbox is implemented and enabled.
        guard_target(job.origin, _host_of(job.origin))

        # Throttle: on_progress fires twice per probe, so an unthrottled write would be ~90 UPDATEs
        # a grade for a field nothing queries. A PHASE change always gets through, since that is the
        # part that explains a long silence ("measuring performance" during Lighthouse).
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
        # An ENTRY challenge means nothing was graded on THIS app. Whether that means our IP is
        # flagged depends on whether it keeps happening across different apps, which is what
        # _Reputation.observe decides; a LATE challenge never trips anything.
        rep.observe(job.origin, result.get("challenge_stage") or "")
    except EgressNotReady as e:
        db.mark_failed(conn, job.id, str(e))
        print(f"[blocked] {job.id}: {e}", flush=True)
    except Unreachable as e:
        db.mark_failed(conn, job.id, f"target not gradeable: {e}")
        print(f"[fail]  {job.id}: unreachable: {e}", flush=True)
    except Exception as e:  # noqa: BLE001 — one bad grade must not kill the worker
        db.mark_failed(conn, job.id, f"worker error: {e}")
        print(f"[error] {job.id}: {e}", flush=True)
    finally:
        beat.set("polling", "", None)        # grade over, whatever the outcome
        db.save_progress(conn, job.id, None)
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
    beat = _Heartbeat()
    beat.start()
    rep = _Reputation()
    last_reap = 0.0
    last_halt = ""
    while True:
        try:
            # Reclaim jobs a killed worker abandoned, and fail ones nobody ever started. Cheap, and
            # only worth doing occasionally.
            if time.time() - last_reap > 60:
                last_reap = time.time()
                n = db.reap_stale_jobs(conn)
                if n:
                    print(f"[reap]  returned or failed {n} stale job(s)", flush=True)
                n = db.expire_queued_jobs(conn)
                if n:
                    print(f"[reap]  failed {n} grade(s) nobody started within the queue window",
                          flush=True)

            # Say WHY we are idle, but only when the reason changes: this loop runs every 5s.
            halted = rep.blocked(conn)
            if halted != last_halt:
                if halted:
                    print(f"[hold]  not claiming: {halted}", flush=True)
                last_halt = halted

            # Tell the heartbeat thread what to report. It does the writing on its own timer, so
            # liveness keeps flowing while process_one blocks for minutes on a grade.
            beat.set("holding" if halted else "polling", halted)

            worked = process_one(conn, rep, beat)
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
