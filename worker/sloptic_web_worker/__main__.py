"""Worker entry point: python -m sloptic_web_worker

A SUPERVISOR, not a grader. It claims queued grades, runs each one in a child process
(`grade_child`), holds every child to a wall clock, and persists nothing itself: a child writes its
own result, so a supervisor restart cannot lose a finished grade.

It is built this way for one reason. A grade can wedge somewhere no timeout reaches: a Playwright
sync call against a CPU-spun renderer holds the GIL, so the grade cannot time itself out and no
signal it might handle is ever scheduled. Grading in this loop meant a single wedged app pinned the
only worker forever, while the heartbeat thread kept truthfully reporting the process alive and the
queue behind it aged out at the 15-minute queue timeout. An external SIGKILL of the child's process
group is the only thing that ends it, and it takes the headless Chrome with it.

Running several at once follows from the same decision: separate processes are what let sloptic's
cross-process Lighthouse lock serialize the trace lane, which is what keeps the perf axis comparable
to the frozen curve while everything else runs in parallel.

An empty queue sleeps POLL_INTERVAL_SECONDS. Any grade error fails just that job; the loop never dies.
"""

import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass

from . import config, db
from .egress import install as install_egress
from .grade_child import EXIT_ENTRY_CHALLENGE


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


@dataclass
class _Running:
    job: db.Job
    proc: subprocess.Popen
    started: float

    def age(self) -> float:
        return time.time() - self.started


def _spawn(job: db.Job) -> _Running:
    """Start a child on its OWN session, so `killpg` reaches the grade and everything it spawned.
    Without start_new_session the child shares our process group and killing it would take the
    supervisor with it."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "sloptic_web_worker.grade_child", job.id],
        start_new_session=True,
    )
    return _Running(job=job, proc=proc, started=time.time())


def _kill(run: _Running) -> None:
    """SIGKILL the child AND its descendants (headless Chrome, node). Not SIGTERM: the case this
    exists for is a GIL-holding C-spin, which never runs a Python signal handler."""
    try:
        os.killpg(os.getpgid(run.proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        run.proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        print(f"[kill]  {run.job.id}: did not reap after SIGKILL", flush=True)


def harvest(conn, rep: "_Reputation", running: list[_Running]) -> bool:
    """Reap finished children and kill any that blew the deadline. Returns whether anything changed."""
    changed = False
    for run in list(running):
        code = run.proc.poll()

        if code is None:
            if run.age() <= config.GRADE_TIMEOUT_SECONDS:
                continue
            # The deadline counts from the claim, so it includes any wait for the Lighthouse trace
            # lane. Fail rather than requeue: a wedge is usually a property of the app, so retrying
            # would spend the limit again (and two more slots) to reach the same place, and telling
            # someone plainly that their app did not finish beats three silent retries.
            mins = config.GRADE_TIMEOUT_SECONDS / 60
            print(f"[kill]  {run.job.id} {run.job.origin}: over {mins:.0f} min, killing", flush=True)
            _kill(run)
            db.mark_failed(
                conn, run.job.id,
                f"grading did not finish within {mins:.0f} minutes and was stopped",
            )
            db.save_progress(conn, run.job.id, None)
            running.remove(run)
            changed = True
            continue

        running.remove(run)
        changed = True
        # An ENTRY challenge means nothing was graded on THIS app. Whether that says anything about
        # our IP depends on it repeating across different apps, which _Reputation.observe decides.
        rep.observe(run.job.origin, "entry" if code == EXIT_ENTRY_CHALLENGE else "")
        if code < 0:
            # Killed by a signal we did not send (OOM killer, an operator). The child never got to
            # write a reason, so the row would sit in `running` until the reaper found it.
            print(f"[error] {run.job.id}: child died on signal {-code}", flush=True)
            db.mark_failed(conn, run.job.id, f"the grader process was killed (signal {-code})")
            db.save_progress(conn, run.job.id, None)
        print(f"[reap]  {run.job.id} exit={code} after {run.age():.0f}s "
              f"({len(running)} still running)", flush=True)
    return changed


def fill(conn, running: list[_Running]) -> bool:
    """Claim up to the concurrency limit. Returns whether anything was started."""
    started = False
    # The budget was checked once for this pass, so a fill can overshoot it by at most
    # MAX_CONCURRENT_GRADES - 1. That is deliberate: re-reading it per claim would cost a query per
    # job to defend a soft daily cap against an overshoot of three.
    while len(running) < config.MAX_CONCURRENT_GRADES:
        job = db.claim_job(conn)
        if job is None:
            break
        print(f"[claim] {job.id} {job.origin} (mode={job.mode}, "
              f"{len(running) + 1}/{config.MAX_CONCURRENT_GRADES})", flush=True)
        running.append(_spawn(job))
        started = True
    return started


def main() -> None:
    # The grader's resolver guard is opt-in as of sloptic 2.1.0. Every child installs it, and
    # pipeline.run() installs it again inside the grade; this covers what the SUPERVISOR itself does.
    # Idempotent, and it must happen before the first outbound connection of any kind.
    install_egress()
    print(f"sloptic-web worker starting (poll={config.POLL_INTERVAL_SECONDS}s, "
          f"egress_ready={config.EGRESS_SANDBOX_READY}, "
          f"budget={config.DAILY_GRADE_BUDGET}/day, "
          f"concurrency={config.MAX_CONCURRENT_GRADES}, "
          f"deadline={config.GRADE_TIMEOUT_SECONDS / 60:.0f}min, "
          f"lighthouse_slots={config.LIGHTHOUSE_SLOTS})", flush=True)
    conn = db.connect()
    beat = _Heartbeat()
    beat.start()
    rep = _Reputation()
    running: list[_Running] = []
    last_reap = 0.0
    last_halt = ""
    while True:
        try:
            # Reclaim jobs a killed worker abandoned, and fail ones nobody ever started. This is
            # finally reachable while grades are in flight: the loop no longer blocks on one.
            if time.time() - last_reap > 60:
                last_reap = time.time()
                n = db.reap_stale_jobs(conn)
                if n:
                    print(f"[reap]  returned or failed {n} stale job(s)", flush=True)
                n = db.expire_queued_jobs(conn)
                if n:
                    print(f"[reap]  failed {n} grade(s) nobody started within the queue window",
                          flush=True)

                # Retention: an unowned report is not kept forever (migration 0009).
                dropped, forgotten = db.sweep_retention(conn)
                if dropped or forgotten:
                    print(f"[keep]  dropped {dropped} expired report(s), "
                          f"forgot {forgotten} submitter IP hash(es)", flush=True)

            # Reap what finished and kill what ran long, BEFORE claiming, so a freed slot is filled
            # on the same pass.
            worked = harvest(conn, rep, running)

            # Say WHY we are idle, but only when the reason changes: this loop runs every 5s.
            halted = rep.blocked(conn)
            if halted != last_halt:
                if halted:
                    print(f"[hold]  not claiming: {halted}", flush=True)
                last_halt = halted

            # The heartbeat thread does the writing on its own timer. Report the OLDEST in-flight
            # job, which is the one a stuck queue is stuck behind.
            oldest = max(running, key=lambda r: r.age()).job.id if running else None
            if halted:
                beat.set("holding", halted, oldest)
            elif running:
                beat.set("grading", f"{len(running)} of {config.MAX_CONCURRENT_GRADES} in flight",
                         oldest)
            else:
                beat.set("polling", "", None)

            if not halted:
                worked = fill(conn, running) or worked
        except Exception as e:  # connection dropped, etc. — reconnect and keep going
            print(f"[loop] error: {e}; reconnecting", flush=True)
            time.sleep(config.POLL_INTERVAL_SECONDS)
            try:
                conn = db.connect()
            except Exception:
                pass
            continue
        # Sleep only when idle. With children in flight, keep polling so the deadline is enforced
        # promptly rather than up to POLL_INTERVAL late.
        if not worked and not running:
            time.sleep(config.POLL_INTERVAL_SECONDS)
        elif not worked:
            time.sleep(1.0)


if __name__ == "__main__":
    main()
