"""Maintenance and lifecycle: what the supervisor does to the queue on every pass.

These functions run on a 60 second loop forever, against rows nobody is watching. None of them
returns anything to a user, so a bug here is silent: a grade that quietly fails while an organizer
holds a pause, a whole field failed by a window meant for one person's submission, a heartbeat that
does not land and a site that then tells every visitor no grader is running.

The rules asserted here come from supabase/migrations/0024_pause_cancel.sql (pause holds, cancel is
a distinct status), config.py's two queue windows and two daily budgets, the supervisor loop in
sloptic_web_worker/__main__.py (the ORDER: reap and kill before claiming, so a freed slot is filled
on the same pass), and web/app/api/health/route.ts plus web/app/api/grade/[id]/route.ts, which read
the heartbeat and decide what to tell a visitor.
"""
from __future__ import annotations

import inspect
import re

import pytest

from sloptic_web_worker import config, db
from sloptic_web_worker import __main__ as supervisor

# What the read path allows before it calls the worker dead (HEARTBEAT_STALE_SECONDS in both
# web/app/api/health/route.ts and web/app/api/grade/[id]/route.ts). Every beat has to land well
# inside this or the site starts reporting a healthy worker as gone.
READER_STALE_SECONDS = 90


def _grade(conn, *, origin="https://a.example.com", status="queued", run=None,
           submitted_ago=0.0, claimed_ago=None, finished_ago=None, attempts=0, error=None,
           progress=None):
    """One grade row, with its clocks placed relative to now.

    Ages are given in seconds ago rather than as timestamps so a case reads as "older than the
    window" instead of as an arithmetic puzzle.
    """
    row = conn.execute(
        """INSERT INTO grades (origin, submitted_url, mode, status, event_run_id, attempts, error,
                               progress, submitted_at, claimed_at, finished_at)
           VALUES (%(origin)s, %(origin)s, 'passive', %(status)s, %(run)s, %(attempts)s, %(error)s,
                   %(progress)s,
                   now() - make_interval(secs => %(submitted)s::float8),
                   now() - make_interval(secs => %(claimed)s::float8),
                   now() - make_interval(secs => %(finished)s::float8))
           RETURNING id""",
        {"origin": origin, "status": status, "run": run, "attempts": attempts, "error": error,
         "progress": progress, "submitted": submitted_ago, "claimed": claimed_ago,
         "finished": finished_ago},
    ).fetchone()
    return str(row["id"])


def _run(conn, account, *, status="grading", paused=False, slug="hack", priority=0):
    row = conn.execute(
        """INSERT INTO event_runs (account_id, slug, mode, status, paused, priority)
           VALUES (%s, %s, 'passive', %s, %s, %s) RETURNING id""",
        (account, slug, status, paused, priority),
    ).fetchone()
    return str(row["id"])


def _entry(conn, run, grade, url="https://a.example.com"):
    conn.execute(
        "INSERT INTO event_entries (run_id, project_url, app_url, grade_id) VALUES (%s, %s, %s, %s)",
        (run, url, url, grade),
    )


def _row(conn, grade_id):
    return conn.execute(
        "SELECT status, error, attempts, claimed_at, finished_at, submitted_at FROM grades WHERE id = %s",
        (grade_id,),
    ).fetchone()


def _now(conn):
    """The DATABASE's clock. Boot reaping compares a Python timestamp against claimed_at, and a
    test that used the test process's clock would be asserting the absence of skew between two
    machines rather than the rule."""
    return conn.execute("SELECT now() AS t").fetchone()["t"]


def _seconds_since(conn, grade_id, column):
    row = conn.execute(
        f"SELECT extract(epoch from (now() - {column})) AS age FROM grades WHERE id = %s",
        (grade_id,),
    ).fetchone()
    return None if row["age"] is None else float(row["age"])


def _heartbeat_age(conn):
    row = conn.execute(
        "SELECT extract(epoch from (now() - last_seen)) AS age FROM worker_status WHERE id = 'worker'"
    ).fetchone()
    return None if row is None else float(row["age"])


def _lanes(conn, rep):
    """Exactly what the supervisor loop computes from the budgets, kept in one place here.

    Mirrors __main__.main(): `lanes = {l for l in ("public", "event") if l not in blocked}`. The
    budgets do not gate anything by themselves, they only narrow this set, so testing them without
    it would test an integer rather than a behaviour.
    """
    blocked = rep.blocked(conn)
    return {lane for lane in ("public", "event") if lane not in blocked}, blocked


class TestExpireQueuedJobs:
    """The queue window: a grade nobody could start is failed honestly rather than left spinning."""

    def test_a_public_grade_nobody_started_within_the_window_is_failed_and_says_why(self, conn):
        gid = _grade(conn, submitted_ago=config.QUEUE_TIMEOUT_SECONDS + 60)
        assert db.expire_queued_jobs(conn) == 1
        row = _row(conn, gid)
        assert row["status"] == "failed"
        # A submitter watching a progress page needs a finish time and a reason, or the page polls
        # a terminal row forever with nothing to show for it.
        assert row["finished_at"] is not None
        assert row["error"] and "queue window" in row["error"]

    def test_a_grade_still_inside_the_window_is_left_to_wait(self, conn):
        # The window has to outlast a full queue: a healthy worker grinding through a backlog would
        # otherwise fail everyone it had not reached yet, which is exactly what publicity produces.
        gid = _grade(conn, submitted_ago=config.QUEUE_TIMEOUT_SECONDS - 60)
        assert db.expire_queued_jobs(conn) == 0
        assert _row(conn, gid)["status"] == "queued"
        assert db.claim_job(conn).id == gid

    def test_an_event_grade_gets_a_longer_window_than_a_public_one(self, conn, account):
        # An event grade waits behind its whole field AND behind every public submission by design
        # (claim_job orders it last), so the window that suits one person's grade would fail the
        # tail of any real event. These are not stranded grades, they are queued behind work.
        assert config.EVENT_QUEUE_TIMEOUT_SECONDS > config.QUEUE_TIMEOUT_SECONDS
        age = config.QUEUE_TIMEOUT_SECONDS + 60
        run = _run(conn, account)
        field = _grade(conn, origin="https://field.example.com", run=run, submitted_ago=age)
        _entry(conn, run, field, "https://field.example.com")
        mine = _grade(conn, origin="https://mine.example.com", submitted_ago=age)

        assert db.expire_queued_jobs(conn) == 1
        assert _row(conn, mine)["status"] == "failed"
        assert _row(conn, field)["status"] == "queued"

    def test_an_event_grade_past_the_event_window_is_failed_too(self, conn, account):
        # The longer window is still a window: nothing sits queued forever.
        run = _run(conn, account)
        field = _grade(conn, run=run, submitted_ago=config.EVENT_QUEUE_TIMEOUT_SECONDS + 60)
        _entry(conn, run, field)
        assert db.expire_queued_jobs(conn) == 1
        assert _row(conn, field)["status"] == "failed"

    def test_a_paused_run_keeps_its_queued_grades_however_long_the_pause_lasts(self, conn, account):
        # THE bug this guard exists for: pause stops claiming, so a paused run's grades age, and the
        # queue window then failed them out from under the organizer. The pause was defeated by the
        # very fact that it worked. Nothing about a hold means "abandoned".
        run = _run(conn, account, paused=True)
        held = _grade(conn, run=run, submitted_ago=config.EVENT_QUEUE_TIMEOUT_SECONDS * 2)
        _entry(conn, run, held)

        assert db.expire_queued_jobs(conn) == 0
        row = _row(conn, held)
        assert row["status"] == "queued"
        assert row["error"] is None
        assert row["finished_at"] is None

    def test_a_pause_does_not_shelter_another_run_s_grades(self, conn, account):
        # The guard is per run, not global: one organizer holding a board must not stop the window
        # for everybody else, or a single paused run would make the queue unbounded.
        held_run = _run(conn, account, paused=True, slug="held")
        other_run = _run(conn, account, slug="other")
        held = _grade(conn, run=held_run, submitted_ago=config.EVENT_QUEUE_TIMEOUT_SECONDS + 60)
        _entry(conn, held_run, held)
        stale = _grade(conn, run=other_run, origin="https://other.example.com",
                       submitted_ago=config.EVENT_QUEUE_TIMEOUT_SECONDS + 60)
        _entry(conn, other_run, stale, "https://other.example.com")

        assert db.expire_queued_jobs(conn) == 1
        assert _row(conn, held)["status"] == "queued"
        assert _row(conn, stale)["status"] == "failed"

    def test_expiry_does_not_blame_a_worker_for_a_cancelled_run_s_straggler(self, conn, account):
        # Expiry leaves it alone on purpose: failing it with "no worker was available to run it"
        # would be exactly the lie 0024 made a distinct 'cancelled' status to prevent. Closing it is
        # cancel_queued_on_cancelled_runs' job, below.
        run = _run(conn, account, status="cancelled")
        straggler = _grade(conn, run=run, submitted_ago=config.EVENT_QUEUE_TIMEOUT_SECONDS + 60)

        assert db.expire_queued_jobs(conn) == 0

        assert _row(conn, straggler)["status"] == "queued"

    def test_a_cancelled_run_s_straggler_is_closed_rather_than_left_polling(self, conn, account):
        # claim_job refuses a cancelled run's grades and expiry refuses to age them out, so without
        # this the row polls for ever. Reachable rather than theoretical: a grade running through a
        # cancel that the boot sweep later returns to the queue lands in exactly this state.
        run = _run(conn, account, status="cancelled")
        straggler = _grade(conn, run=run)

        assert db.cancel_queued_on_cancelled_runs(conn) == 1

        row = _row(conn, straggler)
        assert row["status"] == "cancelled"
        assert row["error"] == "cancelled by the organizer"
        assert row["finished_at"] is not None

    def test_closing_stragglers_touches_no_live_run_and_no_public_grade(self, conn, account):
        live = _run(conn, account, status="grading")
        theirs = _grade(conn, run=live)
        mine = _grade(conn, origin="https://mine.example.com")

        assert db.cancel_queued_on_cancelled_runs(conn) == 0

        assert _row(conn, theirs)["status"] == "queued"
        assert _row(conn, mine)["status"] == "queued"

    def test_closing_stragglers_is_idempotent(self, conn, account):
        run = _run(conn, account, status="cancelled")
        _grade(conn, run=run)
        db.cancel_queued_on_cancelled_runs(conn)

        assert db.cancel_queued_on_cancelled_runs(conn) == 0
        assert db.claim_job(conn) is None

    def test_it_never_touches_a_grade_that_is_already_running_or_finished(self, conn):
        # Every one of these is older than the window. Expiry is about grades nobody STARTED: a
        # running grade belongs to the stale reaper, and re-failing a finished one would overwrite
        # a real report's outcome with a queue complaint.
        old = config.QUEUE_TIMEOUT_SECONDS * 3
        running = _grade(conn, origin="https://r.example.com", status="running",
                         submitted_ago=old, claimed_ago=30)
        done = _grade(conn, origin="https://d.example.com", status="done",
                      submitted_ago=old, finished_ago=60)
        failed = _grade(conn, origin="https://f.example.com", status="failed", submitted_ago=old,
                        finished_ago=60, error="the app was unreachable")
        cancelled = _grade(conn, origin="https://c.example.com", status="cancelled",
                           submitted_ago=old, finished_ago=60, error="cancelled by the organizer")

        assert db.expire_queued_jobs(conn) == 0
        assert _row(conn, running)["status"] == "running"
        assert _row(conn, done)["status"] == "done"
        assert _row(conn, failed)["error"] == "the app was unreachable"
        assert _row(conn, cancelled)["status"] == "cancelled"

    def test_it_returns_how_many_it_failed(self, conn):
        # The supervisor prints this count and it is the only trace the pass leaves in the log.
        for i in range(3):
            _grade(conn, origin=f"https://old{i}.example.com",
                   submitted_ago=config.QUEUE_TIMEOUT_SECONDS + 60)
        for i in range(2):
            _grade(conn, origin=f"https://new{i}.example.com", submitted_ago=5)
        assert db.expire_queued_jobs(conn) == 3

    def test_running_it_again_changes_nothing(self, conn):
        # It runs every 60 seconds forever, so a second pass must be a no-op rather than move a
        # finish time that a page has already shown.
        gid = _grade(conn, submitted_ago=config.QUEUE_TIMEOUT_SECONDS + 60)
        assert db.expire_queued_jobs(conn) == 1
        before = _row(conn, gid)
        assert db.expire_queued_jobs(conn) == 0
        assert _row(conn, gid) == before

    def test_an_expired_grade_is_distinguishable_from_one_that_failed_while_grading(self, conn):
        # Two different stories that both end in status 'failed', and support needs to tell them
        # apart: nobody started this one (claimed_at is still NULL, and the reason names the queue),
        # versus grading ran and failed.
        never_started = _grade(conn, submitted_ago=config.QUEUE_TIMEOUT_SECONDS + 60)
        graded = _grade(conn, origin="https://g.example.com", status="running", claimed_ago=30)
        db.expire_queued_jobs(conn)
        db.mark_failed(conn, graded, "the app returned 500 on every request")

        a, b = _row(conn, never_started), _row(conn, graded)
        assert a["status"] == b["status"] == "failed"
        assert a["claimed_at"] is None and b["claimed_at"] is not None
        assert a["error"] != b["error"]


class TestBootReaping:
    """Grades left 'running' when the supervisor died, requeued at once rather than after a wait."""

    def test_a_grade_the_previous_supervisor_left_running_goes_back_to_the_queue(self, conn):
        # A deploy takes the whole cgroup, so the children die unable to write a goodbye. At boot
        # the answer is unambiguous: nothing running was claimed by THIS supervisor.
        gid = _grade(conn, status="running", claimed_ago=120)
        boot = _now(conn)
        assert db.reap_abandoned_at_boot(conn, boot) == 1
        row = _row(conn, gid)
        assert row["status"] == "queued"
        # Cleared, or the row would look claimed to anything reading claimed_at, and the grade page
        # starts its "grading" timer from it.
        assert row["claimed_at"] is None

    def test_the_requeued_grade_is_claimable_on_the_same_pass(self, conn):
        # The supervisor reaps before it claims, deliberately, so a slot freed by the dead worker
        # is filled immediately instead of on some later loop.
        gid = _grade(conn, status="running", claimed_ago=120)
        db.reap_abandoned_at_boot(conn, _now(conn))
        assert db.claim_job(conn).id == gid

    def test_it_leaves_alone_a_grade_this_supervisor_claimed_after_booting(self, conn):
        # The whole safety of the boot sweep is the boot timestamp. Without it, the first pass would
        # requeue the worker's own live children and two graders would run the same app.
        boot = _now(conn)
        gid = _grade(conn)
        claimed = db.claim_job(conn)
        assert claimed.id == gid
        assert db.reap_abandoned_at_boot(conn, boot) == 0
        assert _row(conn, gid)["status"] == "running"

    def test_it_leaves_alone_everything_that_is_not_running(self, conn):
        queued = _grade(conn, origin="https://q.example.com")
        done = _grade(conn, origin="https://d.example.com", status="done", finished_ago=600)
        failed = _grade(conn, origin="https://f.example.com", status="failed", finished_ago=600,
                        error="the app was unreachable")
        # A cancelled grade must never come back: the organizer stopped it on purpose, and
        # requeueing it would send traffic at an app after they said stop.
        cancelled = _grade(conn, origin="https://c.example.com", status="cancelled",
                           finished_ago=600, error="cancelled by the organizer")

        assert db.reap_abandoned_at_boot(conn, _now(conn)) == 0
        assert _row(conn, queued)["status"] == "queued"
        assert _row(conn, done)["status"] == "done"
        assert _row(conn, failed)["status"] == "failed"
        assert _row(conn, cancelled)["status"] == "cancelled"

    def test_the_attempt_count_survives_the_requeue(self, conn):
        # Attempts are the only bound on a grade that reliably kills the worker: if a boot reset
        # them, a crash loop plus a deploy loop would retry it for ever.
        gid = _grade(conn, status="running", claimed_ago=120, attempts=2)
        db.reap_abandoned_at_boot(conn, _now(conn))
        assert _row(conn, gid)["attempts"] == 2

    def test_the_requeued_grade_starts_its_queue_window_over(self, conn):
        # It waited out most of its window inside a dead worker, which is not the submitter's fault
        # and not evidence that nobody can grade it. Without this the very next maintenance pass
        # would expire everything the boot sweep had just rescued, so a deploy would fail the queue
        # it was supposed to recover.
        gid = _grade(conn, status="running", submitted_ago=config.QUEUE_TIMEOUT_SECONDS + 600,
                     claimed_ago=300)
        db.reap_abandoned_at_boot(conn, _now(conn))
        assert _seconds_since(conn, gid, "submitted_at") < 5
        assert db.expire_queued_jobs(conn) == 0
        assert _row(conn, gid)["status"] == "queued"

    def test_a_paused_run_s_abandoned_grade_is_requeued_but_still_held(self, conn, account):
        # Requeueing is not the same as resuming. The pause outranks the sweep, so the grade goes
        # back to the queue and stays there until the organizer says otherwise.
        run = _run(conn, account, paused=True)
        gid = _grade(conn, status="running", run=run, claimed_ago=120)
        _entry(conn, run, gid)

        assert db.reap_abandoned_at_boot(conn, _now(conn)) == 1
        assert _row(conn, gid)["status"] == "queued"
        assert db.claim_job(conn) is None

    def test_it_returns_how_many_it_requeued(self, conn):
        for i in range(3):
            _grade(conn, origin=f"https://a{i}.example.com", status="running", claimed_ago=120)
        _grade(conn, origin=f"https://q.example.com")
        assert db.reap_abandoned_at_boot(conn, _now(conn)) == 3

    def test_running_it_again_requeues_nothing(self, conn):
        # Called once per boot in production, but it must be safe to call twice: a supervisor that
        # crashes and restarts in a loop would otherwise keep resetting live claims.
        _grade(conn, status="running", claimed_ago=120)
        boot = _now(conn)
        assert db.reap_abandoned_at_boot(conn, boot) == 1
        assert db.reap_abandoned_at_boot(conn, boot) == 0


class TestMarkFailed:
    """The supervisor's verdict on a child, guarded so it can never overwrite a real outcome."""

    def test_it_records_the_reason_and_a_finish_time(self, conn):
        gid = _grade(conn, status="running", claimed_ago=60)
        db.mark_failed(conn, gid, "grading did not finish within 15 minutes and was stopped")
        row = _row(conn, gid)
        assert row["status"] == "failed"
        assert row["finished_at"] is not None
        assert row["error"] == "grading did not finish within 15 minutes and was stopped"

    def test_a_grade_that_already_landed_its_report_is_never_turned_into_a_failure(self, conn):
        # The harvest reads state up to a poll stale, so the child can commit its result in the
        # breath before the supervisor decides it timed out. The report wins.
        gid = _grade(conn, status="done", finished_ago=1)
        db.mark_failed(conn, gid, "grading did not finish within 15 minutes and was stopped")
        row = _row(conn, gid)
        assert row["status"] == "done"
        assert row["error"] is None

    def test_a_cancelled_grade_is_not_relabelled_as_a_failure(self, conn):
        # 0024 made 'cancelled' distinct from 'failed' so the row says who stopped it. A kill the
        # supervisor performed on the organizer's instruction must not read as the app failing.
        gid = _grade(conn, status="cancelled", finished_ago=1, error="cancelled by the organizer")
        db.mark_failed(conn, gid, "the grader process was killed (signal 9)")
        row = _row(conn, gid)
        assert row["status"] == "cancelled"
        assert row["error"] == "cancelled by the organizer"

    def test_a_queued_grade_is_not_failed_by_a_late_verdict(self, conn):
        # A grade can be requeued (boot sweep, stale reaper) between the kill and the verdict. It is
        # waiting for another try, not finished.
        gid = _grade(conn)
        db.mark_failed(conn, gid, "the grader process was killed (signal 9)")
        row = _row(conn, gid)
        assert row["status"] == "queued"
        assert row["finished_at"] is None

    def test_the_first_reason_stands_when_it_is_called_twice(self, conn):
        # The supervisor can reach the same job twice (a kill, then a reap of the same child). The
        # first reason is the true one; the second would be the consequence.
        gid = _grade(conn, status="running", claimed_ago=60)
        db.mark_failed(conn, gid, "grading did not finish within 15 minutes and was stopped")
        first = _row(conn, gid)
        db.mark_failed(conn, gid, "the grader process was killed (signal 9)")
        assert _row(conn, gid) == first

    def test_a_long_reason_is_truncated_rather_than_rejected(self, conn):
        # The message can be a traceback. Failing to write the verdict would leave the row running
        # for ever, which is strictly worse than a clipped explanation.
        gid = _grade(conn, status="running", claimed_ago=60)
        db.mark_failed(conn, gid, "x" * 5000)
        row = _row(conn, gid)
        assert row["status"] == "failed"
        assert len(row["error"]) == 1000


class TestHeartbeat:
    """Liveness. When this is wrong the site lies to every visitor about whether grading works."""

    def test_it_keeps_exactly_one_row_for_the_worker(self, conn):
        # health and the grade page both read it with maybeSingle(): a second row would make the
        # read ambiguous or fail outright.
        for state in ("polling", "grading", "polling"):
            db.heartbeat(conn, state)
        rows = conn.execute("SELECT id FROM worker_status").fetchall()
        assert [r["id"] for r in rows] == ["worker"]

    def test_every_beat_moves_the_clock_forward_even_when_nothing_else_changed(self, conn):
        # An idle worker updates nothing else in the schema, so this row is the ONLY evidence it
        # exists. If it stops moving, /api/health returns 503 and the grade page tells a waiting
        # submitter the queue is stalled.
        db.heartbeat(conn, "polling")
        conn.execute("UPDATE worker_status SET last_seen = now() - interval '10 minutes'")
        db.heartbeat(conn, "polling")
        age = _heartbeat_age(conn)
        assert age < 5
        assert age < READER_STALE_SECONDS

    def test_every_state_the_supervisor_writes_is_one_the_table_accepts(self, conn):
        # This is migration 0015's bug, and it is worth catching structurally rather than by
        # example: 'grading' was added to the supervisor and not to the check constraint, so EVERY
        # heartbeat written while busy raised, liveness froze for exactly as long as grading lasted,
        # and the site said "no grader is running" while four were. The states are read out of the
        # supervisor's own source so adding a fourth without a migration fails here.
        states = set(re.findall(r'beat\.set\(\s*"([a-z]+)"', inspect.getsource(supervisor)))
        assert {"polling", "grading", "holding"} <= states
        for state in sorted(states):
            conn.execute("UPDATE worker_status SET last_seen = now() - interval '10 minutes'")
            db.heartbeat(conn, state)
            row = conn.execute("SELECT state FROM worker_status").fetchone()
            assert row["state"] == state, f"the supervisor writes {state!r} and the table refused it"
            assert _heartbeat_age(conn) < 5

    def test_the_in_flight_grade_is_reported_and_then_cleared(self, conn):
        # /api/health reports it, and it is how an operator finds the grade a stuck queue is stuck
        # behind. A stale one points at a grade that finished minutes ago.
        gid = _grade(conn, status="running", claimed_ago=60)
        db.heartbeat(conn, "grading", "1 of 4 in flight", gid)
        row = conn.execute("SELECT state, in_flight FROM worker_status").fetchone()
        assert row["state"] == "grading"
        assert str(row["in_flight"]) == gid

        db.heartbeat(conn, "polling")
        assert conn.execute("SELECT in_flight FROM worker_status").fetchone()["in_flight"] is None

    def test_a_hold_carries_its_reason_and_an_idle_beat_drops_it(self, conn):
        # The reason is why an operator can tell "budget spent" from "breaker tripped" without
        # reading the worker's logs, and it must not outlive the hold it explains.
        db.heartbeat(conn, "holding", "daily budget spent (300/300 in 24h)")
        assert conn.execute("SELECT reason FROM worker_status").fetchone()["reason"] == \
            "daily budget spent (300/300 in 24h)"
        db.heartbeat(conn, "polling", "")
        assert conn.execute("SELECT reason FROM worker_status").fetchone()["reason"] is None

    def test_a_long_reason_is_truncated_rather_than_failing_the_beat(self, conn):
        # A beat that raises is a beat that does not land, and the cost of that is the site
        # reporting a live worker as dead. Better a clipped reason than a frozen clock.
        db.heartbeat(conn, "holding", "x" * 2000)
        row = conn.execute("SELECT reason FROM worker_status").fetchone()
        assert len(row["reason"]) == 500
        assert _heartbeat_age(conn) < 5

    def test_the_first_beat_creates_the_row_that_later_beats_update(self, conn):
        # There is no seeded row: a brand new database, or the worker's first start after one is
        # rebuilt, has to insert. Silently doing nothing here would read as "no worker has ever
        # checked in" for ever.
        assert conn.execute("SELECT count(*) AS n FROM worker_status").fetchone()["n"] == 0
        db.heartbeat(conn, "polling")
        assert conn.execute("SELECT count(*) AS n FROM worker_status").fetchone()["n"] == 1


class TestDailyLaneBudgets:
    """Two separate ceilings, and the lane set claim_job is driven with."""

    def test_it_counts_only_grades_that_finished_inside_the_last_day(self, conn):
        # It is a ROLLING 24 hours read from the database, not a counter in the process, so a
        # restart cannot hand the worker a fresh allowance.
        _grade(conn, origin="https://a.example.com", status="done", finished_ago=3600)
        _grade(conn, origin="https://b.example.com", status="failed", finished_ago=3600,
               error="the app was unreachable")
        _grade(conn, origin="https://c.example.com", status="done", finished_ago=25 * 3600)
        _grade(conn, origin="https://d.example.com", status="running", claimed_ago=60)
        _grade(conn, origin="https://e.example.com")
        # A failed grade still spent the IP's standing and the box's time, so it counts.
        assert db.grades_in_last_day(conn) == 2

    def test_a_cancelled_grade_does_not_spend_the_allowance(self, conn):
        # cancel_run stamps finished_at on grades that never ran a probe. Charging the day for
        # traffic that was never sent would punish an organizer for stopping early, which is the
        # opposite of what pause and cancel are for.
        _grade(conn, status="cancelled", finished_ago=600, error="cancelled by the organizer")
        assert db.grades_in_last_day(conn) == 0

    def test_the_two_lanes_are_counted_apart(self, conn, account):
        run = _run(conn, account)
        for i in range(3):
            _grade(conn, origin=f"https://field{i}.example.com", run=run, status="done",
                   finished_ago=600)
        for i in range(2):
            _grade(conn, origin=f"https://pub{i}.example.com", status="done", finished_ago=600)

        assert db.grades_in_last_day(conn, "public") == 2
        assert db.grades_in_last_day(conn, "event") == 3
        assert db.grades_in_last_day(conn) == 5

    def test_a_field_that_spent_the_event_allowance_leaves_the_public_lane_open(
            self, conn, account, monkeypatch):
        # The outage this split exists for: with one shared budget a 250 app event exhausted the day
        # and the worker stopped claiming ANYTHING, so an organizer doing exactly what the product
        # invites them to do took the site down for everyone until midnight.
        monkeypatch.setattr(config, "DAILY_EVENT_BUDGET", 2)
        monkeypatch.setattr(config, "DAILY_GRADE_BUDGET", 300)
        run = _run(conn, account)
        for i in range(2):
            _grade(conn, origin=f"https://field{i}.example.com", run=run, status="done",
                   finished_ago=600)
        waiting = _grade(conn, origin="https://field-next.example.com", run=run)
        _entry(conn, run, waiting, "https://field-next.example.com")
        mine = _grade(conn, origin="https://mine.example.com")

        lanes, blocked = _lanes(conn, supervisor._Reputation())
        assert lanes == {"public"}
        assert "event" in blocked and "public" not in blocked
        assert db.claim_job(conn, lanes).id == mine
        assert db.claim_job(conn, lanes) is None
        assert _row(conn, waiting)["status"] == "queued"

    def test_a_busy_public_day_leaves_the_event_lane_open(self, conn, account, monkeypatch):
        # The reverse, and it matters just as much: an organizer's board must not be stopped by a
        # day of anonymous submissions it had nothing to do with.
        monkeypatch.setattr(config, "DAILY_GRADE_BUDGET", 2)
        monkeypatch.setattr(config, "DAILY_EVENT_BUDGET", 500)
        for i in range(2):
            _grade(conn, origin=f"https://pub{i}.example.com", status="done", finished_ago=600)
        run = _run(conn, account)
        field = _grade(conn, origin="https://field.example.com", run=run)
        _entry(conn, run, field, "https://field.example.com")
        _grade(conn, origin="https://mine.example.com")

        lanes, blocked = _lanes(conn, supervisor._Reputation())
        assert lanes == {"event"}
        assert "public" in blocked
        assert db.claim_job(conn, lanes).id == field

    def test_a_lane_closes_at_its_ceiling_rather_than_one_grade_past_it(self, conn, monkeypatch):
        # Off by one here means the brake engages a grade late every day, for ever.
        monkeypatch.setattr(config, "DAILY_GRADE_BUDGET", 2)
        _grade(conn, origin="https://a.example.com", status="done", finished_ago=600)
        rep = supervisor._Reputation()
        assert _lanes(conn, rep)[0] == {"public", "event"}
        _grade(conn, origin="https://b.example.com", status="done", finished_ago=600)
        assert "public" in _lanes(conn, rep)[1]

    def test_a_restart_does_not_hand_the_worker_a_fresh_allowance(self, conn, monkeypatch):
        # Counted in the database for exactly this reason: a crash loop would otherwise reset the
        # brake on every restart, which is the one case it is most needed.
        monkeypatch.setattr(config, "DAILY_GRADE_BUDGET", 1)
        _grade(conn, origin="https://a.example.com", status="done", finished_ago=600)
        assert "public" in _lanes(conn, supervisor._Reputation())[1]
        # A brand new _Reputation is what a restarted process gets.
        assert "public" in _lanes(conn, supervisor._Reputation())[1]

    def test_yesterday_s_spending_does_not_hold_today_s_lane(self, conn, monkeypatch):
        # Rolling, so the hold releases by itself. A budget that never decayed would need a human to
        # restart the worker to make grading work again.
        monkeypatch.setattr(config, "DAILY_GRADE_BUDGET", 1)
        _grade(conn, origin="https://a.example.com", status="done", finished_ago=25 * 3600)
        assert _lanes(conn, supervisor._Reputation())[0] == {"public", "event"}

    def test_the_challenge_breaker_holds_both_lanes_at_once(self, conn):
        # The budgets are per lane because they are about who is waiting. The breaker is about our
        # IP standing, which is shared, so it stops everything: continuing on either lane re-warms
        # the flag we are waiting out.
        rep = supervisor._Reputation()
        rep.trip("25 consecutive grades challenged at entry")
        lanes, blocked = _lanes(conn, rep)
        assert lanes == set()
        assert set(blocked) == {"public", "event"}

    def test_nothing_is_claimed_while_every_lane_is_held(self, conn, account):
        # The supervisor skips fill() entirely when the lane set is empty, and claim_job must agree,
        # since a held lane that still claimed would defeat both brakes.
        rep = supervisor._Reputation()
        rep.trip("25 consecutive grades challenged at entry")
        run = _run(conn, account)
        field = _grade(conn, origin="https://field.example.com", run=run)
        _entry(conn, run, field, "https://field.example.com")
        mine = _grade(conn, origin="https://mine.example.com")

        lanes, _ = _lanes(conn, rep)
        assert db.claim_job(conn, lanes) is None
        assert _row(conn, mine)["status"] == "queued"
        assert _row(conn, field)["status"] == "queued"

    def test_a_held_lane_does_not_expire_the_grades_it_is_holding_early(self, conn, monkeypatch):
        # A hold and the queue window are different clocks. Inside the window a held grade waits;
        # the window is what eventually admits that nobody is going to get to it.
        monkeypatch.setattr(config, "DAILY_GRADE_BUDGET", 0)
        gid = _grade(conn, submitted_ago=60)
        lanes, _ = _lanes(conn, supervisor._Reputation())
        assert lanes == {"event"}
        assert db.claim_job(conn, lanes) is None
        assert db.expire_queued_jobs(conn) == 0
        assert _row(conn, gid)["status"] == "queued"


class TestTheChallengeBreakerCountsApps:
    """The streak is a claim about US, so it has to be about many apps refusing us.

    It counted GRADES, so one stubborn origin resubmitted enough times could trip a 48 hour backoff
    on its own and stop grading for everybody, which is the opposite of the sentence the branch
    prints while counting ("one app's WAF is not our standing").
    """

    def _rep(self, monkeypatch, trip_at=3):
        from sloptic_web_worker import __main__ as supervisor

        monkeypatch.setattr(config, "CHALLENGE_TRIP_STREAK", trip_at)
        return supervisor._Reputation()

    def test_one_origin_challenging_repeatedly_does_not_trip_it(self, monkeypatch):
        rep = self._rep(monkeypatch)
        for _ in range(10):
            rep.observe("https://stubborn.example.com", "entry")
        assert rep.backing_off() is False

    def test_enough_different_origins_does_trip_it(self, monkeypatch):
        rep = self._rep(monkeypatch)
        for host in ("a", "b", "c"):
            rep.observe(f"https://{host}.example.com", "entry")
        assert rep.backing_off() is True

    def test_reaching_any_app_clears_the_streak(self, monkeypatch):
        # Getting through to one app is evidence our IP is fine, whatever the others did.
        rep = self._rep(monkeypatch)
        rep.observe("https://a.example.com", "entry")
        rep.observe("https://b.example.com", "entry")
        rep.observe("https://c.example.com", "")
        rep.observe("https://d.example.com", "entry")
        assert rep.backing_off() is False


def _event_claim(conn, account, *, slug="hack", status="pending", check_status="ok", days_old=0):
    row = conn.execute(
        """INSERT INTO event_claims (account_id, slug, token, status, check_status, issued_at)
           VALUES (%s, %s, %s, %s, %s, now() - make_interval(days => %s)) RETURNING id""",
        (account, slug, f"tok-{slug}", status, check_status, days_old),
    ).fetchone()
    return str(row["id"])


def _claim_row(conn, cid):
    return conn.execute("SELECT * FROM event_claims WHERE id = %s", (cid,)).fetchone()


class TestExpiringEventClaims:
    """'ok' means we read the pages and the link was not there, which is an organizer part way
    through a task, so it gets the long window. 'blocked' means we could not read them at all and
    expires under no window, which is the entire reason the type is tri-state. 'not_found' never
    reaches here: the checker fails it on sight."""

    def test_a_read_event_still_missing_its_link_expires(self, conn, account):
        cid = _event_claim(conn, account, check_status="ok", days_old=30)

        assert db.expire_stale_claims(conn, 14) == 1
        assert _claim_row(conn, cid)["status"] == "failed"

    def test_it_is_spared_inside_the_window(self, conn, account):
        cid = _event_claim(conn, account, check_status="ok", days_old=3)

        assert db.expire_stale_claims(conn, 14) == 0
        assert _claim_row(conn, cid)["status"] == "pending"

    def test_a_claim_we_could_never_read_expires_under_no_window(self, conn, account):
        # Being unable to reach Devpost is not evidence about the organizer. Failing on it would
        # blame them for our own blindness, which is the mistake the tri-state exists to prevent.
        cid = _event_claim(conn, account, check_status="blocked", days_old=90)

        assert db.expire_stale_claims(conn, 14) == 0
        assert _claim_row(conn, cid)["status"] == "pending"

    def test_a_verified_claim_is_never_swept(self, conn, account):
        cid = _event_claim(conn, account, status="verified", check_status="ok", days_old=365)

        assert db.expire_stale_claims(conn, 14) == 0
        assert _claim_row(conn, cid)["status"] == "verified"


class TestAnEventThatDoesNotExist:
    """A 404 for the whole event is conclusive, so the claim is failed on sight rather than polled.
    Before this it was re-checked every thirty minutes for ever: one typo bought a permanent job
    fetching a page nobody will create."""

    def test_it_is_failed_immediately(self, conn, account):
        cid = _event_claim(conn, account, check_status=None)

        db.fail_claim(conn, cid, "No event at nope.devpost.com. Check the address.")

        row = _claim_row(conn, cid)
        assert row["status"] == "failed"
        assert row["check_status"] == "not_found"

    def test_the_reason_names_the_actual_problem(self, conn, account):
        # "The link was never found on the event pages" would send someone to edit a page that does
        # not exist.
        cid = _event_claim(conn, account, check_status=None)

        db.fail_claim(conn, cid, "No event at nope.devpost.com. Check the address.")

        assert "No event at nope.devpost.com" in _claim_row(conn, cid)["check_detail"]

    def test_it_does_not_reopen_a_claim_that_already_settled(self, conn, account):
        cid = _event_claim(conn, account, status="verified", check_status="ok")

        db.fail_claim(conn, cid, "No event there.")

        assert _claim_row(conn, cid)["status"] == "verified"
