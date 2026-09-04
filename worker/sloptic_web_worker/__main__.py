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

import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import traceback
import time
from dataclasses import dataclass

from . import config, db, grader, resolve_event, verify_event
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

    def blocked(self, conn) -> dict[str, str]:
        """Which lanes may not be claimed right now, and why. Empty means both are open.

        Per lane, because the budgets are. A spent event allowance must not stop someone's single
        grade, and the reverse: sharing one budget meant a large field took the whole site down for
        the rest of the day. The challenge backoff is the exception and blocks both, since it is
        about our IP and not about who is waiting.
        """
        if time.time() < self.paused_until:
            left = (self.paused_until - time.time()) / 3600
            why = f"challenge backoff, {left:.1f}h left ({self.pause_reason})"
            return {"public": why, "event": why}
        if self.paused_until:                       # the pause just expired
            print("[breaker] backoff elapsed; resuming.", flush=True)
            self.paused_until = 0.0

        out: dict[str, str] = {}
        pub = db.grades_in_last_day(conn, "public")
        if pub >= config.DAILY_GRADE_BUDGET:
            out["public"] = f"daily budget spent ({pub}/{config.DAILY_GRADE_BUDGET} in 24h)"
        ev = db.grades_in_last_day(conn, "event")
        if ev >= config.DAILY_EVENT_BUDGET:
            out["event"] = f"event budget spent ({ev}/{config.DAILY_EVENT_BUDGET} in 24h)"
        return out


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


def _retry_pass(origin: str, mode: str, only_probes: list | None) -> dict:
    """Run one recovery pass in a child on its OWN session and return the result record.

    Own session + killpg, same as a grade child: the pass renders pages (Playwright) and can wedge,
    and an orphaned Chrome must not outlive it. The serial injection pools are set in the child's
    environment only, since the grader reads them once at import; the child writes the result to a
    temp file because stdout already belongs to the grader's noise.
    """
    out = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, prefix="sloptic-retry-")
    out.close()
    try:
        cmd = [sys.executable, "-m", "sloptic_web_worker.retry_child", origin, mode, out.name]
        if only_probes:
            cmd.append(json.dumps(only_probes))
        env = {**os.environ,
               "SLOPTIC_INJECT_POOL": config.RETRY_INJECT_POOL,
               "SLOPTIC_EXPOSURE_POOL": config.RETRY_INJECT_POOL}
        proc = subprocess.Popen(cmd, start_new_session=True, env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            proc.wait(timeout=config.GRADE_TIMEOUT_SECONDS + 300)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            proc.wait(timeout=10)
            print(f"[retry] {origin}: pass exceeded its wall clock, killed", flush=True)
            raise
        if proc.returncode != 0:
            err = (proc.stderr.read() or b"").decode(errors="replace").strip()
            raise RuntimeError(f"retry child exited {proc.returncode}: {err[-400:]}")
        with open(out.name) as f:
            return json.load(f)
    finally:
        try:
            os.unlink(out.name)
        except OSError:
            pass


def process_retries(conn) -> int:
    """Re-run one grade's WAF-blocked probe tail and fold the result back in.

    The pass runs in a child (retry_child): a padded one is near a full battery long, and the serial
    injection pools have to differ from the main grade's, which is per-process. The child grades;
    this claims, merges, and books whatever comes next.
    """
    r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS)
    if r is None:
        return 0
    pad = grader.benign_pad(set(r.blocked)) if (r.mode == "active" and config.RETRY_PAD_BENIGN) else []
    print(f"[retry] {r.grade_id}: pass {r.passes} over {len(r.blocked)} blocked probe(s)"
          f"{f' +{len(pad)} benign pad' if pad else ''}, serial injection", flush=True)
    try:
        again = _retry_pass(r.origin, r.mode, pad + list(r.blocked) if r.mode == "active" else None)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        print(f"[retry] {r.grade_id}: pass failed: {type(e).__name__}: {e}", flush=True)
        # A crashing pass must be bounded like a blocked one: claim_retry counts it (passes was
        # incremented on the claim) but books no verdict, so without this the due date simply
        # returns every lock interval, for ever. Out of passes means stop asking.
        if r.passes >= config.RETRY_BLOCKED_MAX_PASSES:
            db.clear_retry(conn, r.grade_id)
            print(f"[retry] {r.grade_id}: out of passes after repeated failures, stopping", flush=True)
        else:
            db.schedule_retry(conn, r.grade_id, r.blocked,
                              config.RETRY_BLOCKED_NEXT_DELAY_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        return 1

    stored = db.load_result(conn, r.grade_id)
    if stored is None:
        db.clear_retry(conn, r.grade_id)
        return 1
    try:
        overlay = set(r.blocked) if r.mode == "active" else None
        merged = grader.merge_retry(stored, again, r.blocked, overlay_ids=overlay)
    except ValueError as e:
        # A shape we do not understand is not something to guess at: leave the stored result alone.
        print(f"[retry] {r.grade_id}: cannot merge: {e}", flush=True)
        db.clear_retry(conn, r.grade_id)
        return 1

    db.save_result(conn, r.grade_id, merged)
    recovered = len(r.blocked) - len(merged.get("blocked_probes") or [])
    print(f"[retry] {r.grade_id}: recovered {recovered} of {len(r.blocked)}, "
          f"slop {stored.get('slop_score')} -> {merged.get('slop_score')}", flush=True)
    if not merged.get("blocked_probes") or r.passes >= config.RETRY_BLOCKED_MAX_PASSES:
        db.clear_retry(conn, r.grade_id)
    else:
        # Still blocked with a pass left: book it at the escalated cooldown, from NOW, so the wait
        # covers the block the pass just re-tripped rather than resuming a stale countdown.
        db.schedule_retry(conn, r.grade_id, merged["blocked_probes"],
                          config.RETRY_BLOCKED_NEXT_DELAY_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
    return 1


def process_event_runs(conn) -> int:
    """Resolve the field for one run that is waiting on it. Grades nothing.

    Separate from grading on purpose: this is the step whose output the organizer approves, and it
    has to finish before anything is probed.
    """
    run = db.claim_event_run(conn)
    if run is None:
        return 0
    # Urgency first: the state is one API call and it decides where this run's grades sit in the
    # queue, so it has to be known before any of them are enqueued.
    try:
        # Inside the guard ON PURPOSE: these run after the claim marked started_at, and a raise
        # here (a dropped connection is the realistic one) used to wedge the run in `resolving`
        # for ever, since only the resolver ever re-arms started_at and only the resolver is
        # re-claimed. fail_run is reached from here, which is the honest exit.
        w = verify_event.window_state(run.slug)
        db.set_run_priority(conn, run.id, verify_event.priority_of(w.state))


        # Report the count as it climbs, so a big gallery does not read as a stalled page.
        prior = db.field_prior(conn, run.id)
        field = resolve_event.resolve(
            run.slug, on_progress=lambda n: db.note_resolve_progress(conn, run.id, n),
            refresh=run.refresh_requested,
        )
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        db.fail_run(conn, run.id, f"worker error: {type(e).__name__}: {e}")
        print(f"[run]   {run.slug}: failed to resolve", flush=True)
        return 1
    gradeable = sum(1 for e in field.entries if e.skip_reason is None)
    # A refresh describes itself against the field the organizer last saw: entries the gallery now
    # lists that were not there, and known ones whose grade target or eligibility moved. Counted
    # from rows, not the cache, so a cold cache cannot call all 194 "new".
    counts = None
    new = modified = 0
    if run.refresh_requested:
        fresh = {e.project_url: (e.app_url, e.skip_reason) for e in field.entries}
        new = sum(1 for u in fresh if u not in prior)
        modified = sum(1 for u, v in fresh.items() if u in prior and prior[u] != v)
        counts = (new, modified)
    db.save_field(conn, run.id, field.entries, field.complete, field.detail, counts)
    print(f"[run]   {run.slug}: {len(field.entries)} entries, {gradeable} gradeable, "
          f"complete={field.complete}"
          + (f", {new} new, {modified} modified" if counts else ""), flush=True)
    return 1


def process_event_checks(conn) -> int:
    """Settle any event claims due for a look. Returns how many were checked.

    Runs inline rather than in a child process. A check is two HTTP GETs against one host, so it has
    none of the wedge risk that put grading in its own process, and it finishes in seconds.
    """
    n = 0
    while n < 5:                      # a few per pass, so a backlog drains without starving grading
        claim = db.claim_event_check(conn)
        if claim is None:
            break
        n += 1
        try:
            out = verify_event.check(claim.slug, claim.token)
        except Exception as e:  # noqa: BLE001
            # Do NOT let this reach the loop's catch-all. That handler prints one line with no
            # traceback and records nothing on the row, so the claim just sat at attempts=8 with a
            # null checked_at: the worker was failing every five minutes and saying so nowhere a
            # reader could look. A failure we cannot see is the recurring bug in this project.
            detail = f"worker error: {type(e).__name__}: {e}"
            traceback.print_exc()
            print(f"[event] {claim.slug}: {detail}", flush=True)
            db.record_check(conn, claim.id, "error", detail, 15 * 60)
            continue
        if out.verified:
            # Captured at the moment of verification, because that is the question the participant
            # notice asks: was the window still open when this event was proven, not now.
            w = verify_event.window_state(claim.slug)
            result = db.verify_claim(conn, claim, out.detail, config.GRANT_DAYS, w.open, w.state)
            if result == "granted":
                print(f"[event] verified {claim.slug} for {claim.account_id}", flush=True)
            else:
                print(f"[event] {claim.slug}: link found, but the account has not accepted the "
                      f"terms, so no grant was written", flush=True)
            continue

        # Not verified. How soon to look again depends on WHY, which is the whole reason the check
        # reports three states instead of a boolean. A block is OUR problem and backs off hard; a
        # page read cleanly with no link is the organizer's turn to act, so we idle rather than
        # hammer Devpost while they edit their rules.
        delay = {"blocked": 15 * 60, "not_found": 30 * 60, "ok": 5 * 60}.get(out.check_status, 900)
        if out.check_status == "blocked":
            delay = min(4 * 3600, delay * max(1, claim.attempts))
        db.record_check(conn, claim.id, out.check_status, out.detail, delay)
        print(f"[event] {claim.slug}: {out.check_status}, looking again in {delay // 60}m", flush=True)
    return n


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


def fill(conn, running: list[_Running], lanes: set[str]) -> bool:
    """Claim up to the concurrency limit, from the lanes still inside their allowance."""
    started = False
    # The budget was checked once for this pass, so a fill can overshoot it by at most
    # MAX_CONCURRENT_GRADES - 1. That is deliberate: re-reading it per claim would cost a query per
    # job to defend a soft daily cap against an overshoot of three.
    while len(running) < config.MAX_CONCURRENT_GRADES:
        job = db.claim_job(conn, lanes)
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

                n = db.settle_finished_runs(conn)
                if n:
                    print(f"[run]   {n} event run(s) finished", flush=True)

                n = db.expire_stale_claims(conn, config.CLAIM_EXPIRY_DAYS)
                if n:
                    print(f"[event] failed {n} claim(s) whose link never appeared", flush=True)

                # Retention: an unowned report is not kept forever (migration 0009).
                dropped, forgotten = db.sweep_retention(conn)
                if dropped or forgotten:
                    print(f"[keep]  dropped {dropped} expired report(s), "
                          f"forgot {forgotten} submitter IP hash(es)", flush=True)

            # Reap what finished and kill what ran long, BEFORE claiming, so a freed slot is filled
            # on the same pass.
            worked = harvest(conn, rep, running)

            # Event checks are seconds of HTTP while a grade runs for minutes, so they are settled
            # every pass rather than waiting behind the grade queue.
            worked = process_event_checks(conn) > 0 or worked
            worked = process_event_runs(conn) > 0 or worked
            worked = process_retries(conn) > 0 or worked

            # Say WHY we are idle, but only when the reason changes: this loop runs every 5s.
            blocked = rep.blocked(conn)
            lanes = {l for l in ("public", "event") if l not in blocked}
            halted = "; ".join(f"{l}: {why}" for l, why in sorted(blocked.items()))
            if halted != last_halt:
                if halted:
                    print(f"[hold]  not claiming: {halted}", flush=True)
                last_halt = halted

            # The heartbeat thread does the writing on its own timer. Report the OLDEST in-flight
            # job, which is the one a stuck queue is stuck behind.
            oldest = max(running, key=lambda r: r.age()).job.id if running else None
            if not lanes:
                beat.set("holding", halted, oldest)
            elif running:
                beat.set("grading", f"{len(running)} of {config.MAX_CONCURRENT_GRADES} in flight",
                         oldest)
            else:
                beat.set("polling", "", None)

            if lanes:
                worked = fill(conn, running, lanes) or worked
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
