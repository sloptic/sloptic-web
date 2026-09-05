"""Cancel: the organizer stops what they started, and the worker must not contradict them.

Migration 0024 states the deal. The queued grades become 'cancelled' (a distinct status, not
failed, since "did not respond" would be a lie about who stopped them), the entries that pointed at
them are unlinked so those apps are gradeable again, and the run itself is marked cancelled. What
0024 does not say, and what the web half (web/app/api/events/run/cancel/route.ts) settles, is that a
grade already RUNNING is left for the worker: the supervisor finds it through
running_on_cancelled_runs, kills the child, marks it cancelled and unlinks its entry. Two halves
write the same rows here, so where they disagree the board disagrees with itself.

These tests also lean on the supervisor calling the cancel path every pass: each of these functions
is run repeatedly against the same rows, so anything that is not idempotent is a bug that shows up
five seconds later.
"""
from __future__ import annotations

from sloptic_web_worker import db


def _run(conn, account, *, status="grading", paused=False, slug="hack", priority=0):
    row = conn.execute(
        """INSERT INTO event_runs (account_id, slug, mode, status, paused, priority)
           VALUES (%s, %s, 'passive', %s, %s, %s) RETURNING id""",
        (account, slug, status, paused, priority),
    ).fetchone()
    return str(row["id"])


def _grade(conn, *, origin="https://a.example.com", status="queued", run=None, submitted="now()",
           account=None, claimed="NULL", retry_due="NULL"):
    # The clock columns are SQL fragments rather than parameters: every case here is about a moment
    # relative to now, and pinning them to a python clock is how a test starts disagreeing with the
    # database it is asserting against.
    row = conn.execute(
        f"""INSERT INTO grades (origin, submitted_url, mode, status, event_run_id, submitted_at,
                                account_id, claimed_at, retry_due_at)
            VALUES (%s, %s, 'passive', %s, %s, {submitted}, %s, {claimed}, {retry_due})
            RETURNING id""",
        (origin, origin, status, run, account),
    ).fetchone()
    return str(row["id"])


def _entry(conn, run, grade, url="https://a.example.com"):
    row = conn.execute(
        """INSERT INTO event_entries (run_id, project_url, app_url, grade_id)
           VALUES (%s, %s, %s, %s) RETURNING id""",
        (run, url, url, grade),
    ).fetchone()
    return str(row["id"])


def _result(conn, grade, *, blocked=("sec-headers-001",)):
    conn.execute(
        """INSERT INTO results (grade_id, catalog_version, slop_score, axis_slop, coverage,
                                blocked_probes)
           VALUES (%s, 'sloptic-2.2.0', 12, '{"security": 12, "qa": 0, "performance": 0}'::jsonb,
                   '{}'::jsonb, %s)""",
        (grade, list(blocked)),
    )


def _g(conn, grade_id):
    return conn.execute(
        "SELECT status, error, finished_at, retry_due_at FROM grades WHERE id = %s", (grade_id,)
    ).fetchone()


def _r(conn, run_id):
    return conn.execute(
        "SELECT status, paused, finished_at FROM event_runs WHERE id = %s", (run_id,)
    ).fetchone()


def _link(conn, entry_id):
    row = conn.execute("SELECT grade_id FROM event_entries WHERE id = %s", (entry_id,)).fetchone()
    return None if row["grade_id"] is None else str(row["grade_id"])


class TestCancelRun:
    def test_the_queued_grades_are_dequeued_and_the_run_is_marked_cancelled(self, conn, account):
        run = _run(conn, account)
        a = _grade(conn, origin="https://a.example.com", run=run)
        b = _grade(conn, origin="https://b.example.com", run=run)
        _entry(conn, run, a, "https://a.example.com")
        _entry(conn, run, b, "https://b.example.com")

        assert db.cancel_run(conn, run) == 2

        assert _g(conn, a)["status"] == "cancelled"
        assert _g(conn, b)["status"] == "cancelled"
        row = _r(conn, run)
        assert row["status"] == "cancelled"
        assert row["finished_at"] is not None

    def test_a_dequeued_grade_reads_as_cancelled_not_as_a_grade_that_failed(self, conn, account):
        # 0024 is explicit about this: 'failed' would tell the team their app did not respond, when
        # what actually happened is that the organizer stopped the run. The two are shown
        # differently on the board and only one of them is about the app.
        run = _run(conn, account)
        g = _grade(conn, run=run)
        _entry(conn, run, g)

        db.cancel_run(conn, run)

        row = _g(conn, g)
        assert row["status"] == "cancelled"
        assert row["finished_at"] is not None
        assert "organizer" in row["error"]

    def test_the_dequeued_apps_are_gradeable_again(self, conn, account):
        # The link is what makes the entry "already handled". Leaving it pointed at a cancelled
        # grade would leave the app unable to be graded by the run that comes next.
        run = _run(conn, account)
        g = _grade(conn, run=run)
        entry = _entry(conn, run, g)

        db.cancel_run(conn, run)

        assert _link(conn, entry) is None

    def test_a_running_grade_and_its_entry_link_both_survive_the_cancel(self, conn, account):
        # The worker owns the kill (see the supervisor loop and running_on_cancelled_runs). If the
        # cancel marked a running grade here, the child could land a done report a second later on
        # a row that says cancelled, and the two halves would describe the same grade differently.
        run = _run(conn, account)
        g = _grade(conn, status="running", run=run, claimed="now()")
        entry = _entry(conn, run, g)

        assert db.cancel_run(conn, run) == 0

        assert _g(conn, g)["status"] == "running"
        assert _link(conn, entry) == g

    def test_a_cancel_lifts_the_pause_it_supersedes(self, conn, account):
        # A cancelled run left paused is a contradiction the guards would then both read: pause
        # means "hold these", cancel means "there is nothing to hold".
        run = _run(conn, account, paused=True)
        _grade(conn, run=run)

        db.cancel_run(conn, run)

        row = _r(conn, run)
        assert row["status"] == "cancelled"
        assert row["paused"] is False

    def test_a_ready_run_that_queued_nothing_still_cancels(self, conn, account):
        run = _run(conn, account, status="ready")

        assert db.cancel_run(conn, run) == 0
        assert _r(conn, run)["status"] == "cancelled"

    def test_a_resolving_run_can_be_cancelled(self, conn, account):
        # A resolve that never lands (a dead worker, a blocked gallery) holds the account's one live
        # slot for that event, and no other path releases it, so refusing to cancel here would lock
        # an organizer out of their own event permanently.
        run = _run(conn, account, status="resolving")

        db.cancel_run(conn, run)

        assert _r(conn, run)["status"] == "cancelled"

    def test_cancelling_frees_the_account_s_one_live_run_slot(self, conn, account):
        # Migration 0025 is a partial unique index over the live statuses. Cancel is the release
        # valve: if the run did not leave that set, the organizer could never start another.
        run = _run(conn, account, slug="hack")
        db.cancel_run(conn, run)

        again = _run(conn, account, slug="hack", status="resolving")
        assert again != run

    def test_a_cancel_touches_no_other_run_and_no_public_grade(self, conn, account):
        run = _run(conn, account, slug="hack")
        other = _run(conn, account, slug="other")
        mine = _grade(conn, origin="https://mine.example.com")
        theirs = _grade(conn, origin="https://theirs.example.com", run=other)
        other_entry = _entry(conn, other, theirs, "https://theirs.example.com")

        db.cancel_run(conn, run)

        assert _g(conn, mine)["status"] == "queued"
        assert _g(conn, theirs)["status"] == "queued"
        assert _link(conn, other_entry) == theirs
        assert _r(conn, other)["status"] == "grading"

    def test_booked_retries_die_with_the_run(self, conn, account):
        # A retry is a SECOND PASS of the probes a WAF challenged, and on an active run that tail is
        # the injection family. Firing it minutes after the organizer said stop is traffic they did
        # not authorize any more.
        run = _run(conn, account)
        g = _grade(conn, status="done", run=run, retry_due="now() + interval '10 minutes'")
        _entry(conn, run, g)
        _result(conn, g)

        db.cancel_run(conn, run)

        assert _g(conn, g)["retry_due_at"] is None

    def test_no_further_retry_can_be_booked_on_a_cancelled_run(self, conn, account):
        # Clearing what was booked is only half of it: a grade that finishes right after the cancel
        # would otherwise book its own tail on the way out.
        run = _run(conn, account)
        g = _grade(conn, status="running", run=run, claimed="now()")
        _entry(conn, run, g)

        db.cancel_run(conn, run)

        assert db.schedule_retry(conn, g, ["sec-headers-001"], 1.0, 3) is False
        assert _g(conn, g)["retry_due_at"] is None

    def test_a_retry_of_a_cancelled_run_is_not_claimable_even_if_one_is_on_the_books(self, conn, account):
        # Defence in depth for the same rule: whatever put a due time back on the row (an in-flight
        # pass, a hand edit), the claim must still refuse it, because cancel ends the story.
        run = _run(conn, account)
        g = _grade(conn, status="done", run=run)
        entry = _entry(conn, run, g)
        _result(conn, g)

        db.cancel_run(conn, run)
        conn.execute("UPDATE grades SET retry_due_at = now() - interval '1 minute' WHERE id = %s", (g,))
        conn.execute("UPDATE event_entries SET grade_id = %s WHERE id = %s", (g, entry))

        assert db.claim_retry(conn, 600.0, 99) is None

    def test_a_second_cancel_pass_dequeues_nothing_and_disturbs_no_grade(self, conn, account):
        # The supervisor is a loop, and an organizer can hit the button twice. A cancel that is not
        # idempotent shows up as a board that keeps changing after it stopped.
        run = _run(conn, account)
        queued = _grade(conn, origin="https://q.example.com", run=run)
        running = _grade(conn, origin="https://r.example.com", status="running", run=run, claimed="now()")
        _entry(conn, run, queued, "https://q.example.com")
        running_entry = _entry(conn, run, running, "https://r.example.com")
        db.cancel_run(conn, run)
        before = (_g(conn, queued), _g(conn, running))

        assert db.cancel_run(conn, run) == 0

        assert (_g(conn, queued), _g(conn, running)) == before
        assert _link(conn, running_entry) == running

    def test_a_cancelled_run_is_never_settled_back_into_a_finished_board(self, conn, account):
        # settle_finished_runs runs on the same pass. A cancelled run has nothing queued and nothing
        # running by then, which is exactly the shape of a finished one, so the status filter is the
        # only thing keeping a stopped run from reappearing on the board as a completed one. The run
        # here carries no entry, so nothing but that filter can be doing the work.
        run = _run(conn, account)
        _grade(conn, run=run)
        db.cancel_run(conn, run)

        db.settle_finished_runs(conn)

        assert _r(conn, run)["status"] == "cancelled"

    def test_a_settled_run_is_not_restamped(self, conn, account):
        # The route answers 409 for a run that is done, failed or already cancelled. This is the
        # transactional equivalent of that route, so it has to mean the same thing: a second cancel
        # is a no-op, not an event that moves the finish time.
        run = _run(conn, account, status="cancelled")
        conn.execute("UPDATE event_runs SET finished_at = now() - interval '1 hour' WHERE id = %s", (run,))
        before = _r(conn, run)["finished_at"]

        assert db.cancel_run(conn, run) == 0

        assert _r(conn, run)["finished_at"] == before

    def test_a_finished_run_is_not_reopened_as_cancelled(self, conn, account):
        # A board that completed is a record. Cancelling it after the fact would rewrite what
        # happened, and the route refuses exactly this.
        run = _run(conn, account, status="done")

        assert db.cancel_run(conn, run) == 0

        assert _r(conn, run)["status"] == "done"

    def test_a_finished_report_keeps_its_place_on_the_board(self, conn, account):
        # Only what this call dequeued is unlinked. Unlinking "anything not running" also took every
        # FINISHED grade, so cancelling a part-graded run emptied the board of the reports it had
        # already earned: the rows survived with nothing pointing at them.
        run = _run(conn, account)
        landed = _grade(conn, status="done", run=run)
        waiting = _grade(conn, origin="https://b.example.com", run=run)
        e_landed = _entry(conn, run, landed)
        e_waiting = _entry(conn, run, waiting, "https://b.example.com")

        assert db.cancel_run(conn, run) == 1

        assert _link(conn, e_landed) == landed
        assert _link(conn, e_waiting) is None
        assert _g(conn, landed)["status"] == "done"

    def test_a_claim_cannot_take_a_grade_the_cancel_has_already_locked(self, conn, second, account):
        # The whole reason cancel_run holds one transaction. Mid-cancel the run does not yet read as
        # cancelled to anyone else, so the only thing standing between another worker and a grade
        # that is being dequeued is the row lock the cancel took first. SKIP LOCKED means the other
        # worker walks past it rather than blocking, which is the outcome we want.
        run = _run(conn, account)
        g = _grade(conn, run=run)
        _entry(conn, run, g)

        with conn.transaction():
            assert db.cancel_run(conn, run) == 1
            assert db.claim_job(second) is None

        assert _g(conn, g)["status"] == "cancelled"

    def test_a_grade_claimed_in_the_breath_before_the_cancel_keeps_running(self, conn, second, account):
        # The other order of the same race. The claim landed first, so the grade is running and a
        # child is on it: the cancel must not mark it, and must hand it to the kill loop instead.
        run = _run(conn, account)
        g = _grade(conn, run=run)
        entry = _entry(conn, run, g)

        assert db.claim_job(second).id == g
        assert db.cancel_run(conn, run) == 0

        assert _g(conn, g)["status"] == "running"
        assert _link(conn, entry) == g
        assert db.running_on_cancelled_runs(conn) == [g]

    def test_nothing_of_the_run_is_claimable_once_the_cancel_has_landed(self, conn, second, account):
        # Two guards cover this (the run reads cancelled, and the entries are unlinked). Asserting
        # from the outside means neither can quietly stop carrying its weight.
        run = _run(conn, account)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        db.cancel_run(conn, run)
        conn.execute("UPDATE grades SET status = 'queued' WHERE id = %s", (g,))

        assert db.claim_job(second) is None


class TestRunningOnCancelledRuns:
    def test_it_names_the_running_children_of_a_cancelled_run(self, conn, account):
        run = _run(conn, account)
        a = _grade(conn, origin="https://a.example.com", status="running", run=run, claimed="now()")
        b = _grade(conn, origin="https://b.example.com", status="running", run=run, claimed="now()")
        db.cancel_run(conn, run)

        assert set(db.running_on_cancelled_runs(conn)) == {a, b}

    def test_it_ignores_the_queued_and_the_finished_grades_of_that_run(self, conn, account):
        # Only a live child is worth a kill. Naming a done grade here would send the supervisor to
        # unlink a report that landed, and naming a queued one would double up on the dequeue.
        run = _run(conn, account)
        _grade(conn, origin="https://q.example.com", run=run)
        _grade(conn, origin="https://d.example.com", status="done", run=run)
        _grade(conn, origin="https://f.example.com", status="failed", run=run)
        db.cancel_run(conn, run)

        assert db.running_on_cancelled_runs(conn) == []

    def test_it_ignores_a_run_that_is_only_paused(self, conn, account):
        # 0024 draws the line here: pause stops the next claim, it does not kill what is in flight,
        # because a grade is minutes from landing and killing it buys nothing.
        run = _run(conn, account, paused=True)
        _grade(conn, status="running", run=run, claimed="now()")

        assert db.running_on_cancelled_runs(conn) == []

    def test_it_ignores_live_runs_and_public_submissions(self, conn, account):
        # A public grade belongs to no run and can never be killed by an organizer's cancel.
        live = _run(conn, account, slug="live")
        _grade(conn, origin="https://live.example.com", status="running", run=live, claimed="now()")
        _grade(conn, origin="https://mine.example.com", status="running", claimed="now()")

        assert db.running_on_cancelled_runs(conn) == []

    def test_it_stops_naming_a_child_once_that_child_is_marked_cancelled(self, conn, account):
        # The supervisor asks every pass. If a killed grade kept coming back, the loop would kill a
        # process that no longer exists and unlink its entry over and over.
        run = _run(conn, account)
        g = _grade(conn, status="running", run=run, claimed="now()")
        db.cancel_run(conn, run)
        assert db.running_on_cancelled_runs(conn) == [g]

        db.mark_cancelled(conn, g)

        assert db.running_on_cancelled_runs(conn) == []


class TestMarkCancelled:
    def test_a_killed_child_is_marked_cancelled_with_the_organizer_named_as_the_reason(self, conn, account):
        run = _run(conn, account)
        g = _grade(conn, status="running", run=run, claimed="now()")
        db.cancel_run(conn, run)

        db.mark_cancelled(conn, g)

        row = _g(conn, g)
        assert row["status"] == "cancelled"
        assert row["finished_at"] is not None
        assert "organizer" in row["error"]

    def test_a_report_that_landed_in_the_breath_before_the_kill_wins(self, conn, account):
        # The kill and the child's own write race by milliseconds. If the report got there first,
        # rewriting the row to cancelled would throw away a finished grade and leave the results row
        # attached to a grade that claims it never ran.
        run = _run(conn, account)
        g = _grade(conn, status="done", run=run)
        _result(conn, g)
        conn.execute("UPDATE grades SET finished_at = now() WHERE id = %s", (g,))
        landed = _g(conn, g)["finished_at"]

        db.mark_cancelled(conn, g)

        row = _g(conn, g)
        assert row["status"] == "done"
        assert row["finished_at"] == landed

    def test_a_second_pass_over_the_same_grade_does_not_move_its_finish_time(self, conn, account):
        run = _run(conn, account)
        g = _grade(conn, status="running", run=run, claimed="now()")
        db.mark_cancelled(conn, g)
        first = _g(conn, g)["finished_at"]

        db.mark_cancelled(conn, g)

        assert _g(conn, g)["finished_at"] == first

    def test_it_leaves_a_queued_grade_alone(self, conn, account):
        # Only a claimed grade has a child to kill. A queued one is cancel_run's business, and
        # marking it here would skip the dequeue accounting the organizer is shown.
        run = _run(conn, account)
        g = _grade(conn, run=run)

        db.mark_cancelled(conn, g)

        assert _g(conn, g)["status"] == "queued"

    def test_it_marks_only_the_grade_it_was_given(self, conn, account):
        run = _run(conn, account)
        doomed = _grade(conn, origin="https://a.example.com", status="running", run=run, claimed="now()")
        bystander = _grade(conn, origin="https://b.example.com", status="running", claimed="now()")

        db.mark_cancelled(conn, doomed)

        assert _g(conn, bystander)["status"] == "running"


class TestUnlinkEntriesOf:
    def test_the_apps_of_the_killed_grades_are_gradeable_again(self, conn, account):
        run = _run(conn, account)
        a = _grade(conn, origin="https://a.example.com", status="running", run=run, claimed="now()")
        b = _grade(conn, origin="https://b.example.com", status="running", run=run, claimed="now()")
        ea = _entry(conn, run, a, "https://a.example.com")
        eb = _entry(conn, run, b, "https://b.example.com")

        db.unlink_entries_of(conn, [a, b])

        assert _link(conn, ea) is None
        assert _link(conn, eb) is None

    def test_it_leaves_every_entry_it_was_not_given_alone(self, conn, account):
        # It takes a list of ids, not a run, and the list is the whole authorization. An entry of
        # another run, or a sibling entry of the same run, is not part of this kill.
        run = _run(conn, account, slug="hack")
        other = _run(conn, account, slug="other")
        doomed = _grade(conn, origin="https://a.example.com", status="running", run=run, claimed="now()")
        sibling = _grade(conn, origin="https://b.example.com", status="running", run=run, claimed="now()")
        elsewhere = _grade(conn, origin="https://c.example.com", status="running", run=other, claimed="now()")
        _entry(conn, run, doomed, "https://a.example.com")
        e_sibling = _entry(conn, run, sibling, "https://b.example.com")
        e_elsewhere = _entry(conn, other, elsewhere, "https://c.example.com")

        db.unlink_entries_of(conn, [doomed])

        assert _link(conn, e_sibling) == sibling
        assert _link(conn, e_elsewhere) == elsewhere

    def test_an_empty_kill_list_leaves_the_board_untouched(self, conn, account):
        # The supervisor calls this on a pass where nothing was killed. An empty list that read as
        # "match everything" would wipe the links of every board in the database.
        run = _run(conn, account)
        g = _grade(conn, status="running", run=run, claimed="now()")
        entry = _entry(conn, run, g)

        db.unlink_entries_of(conn, [])

        assert _link(conn, entry) == g

    def test_a_second_pass_over_the_same_ids_changes_nothing(self, conn, account):
        run = _run(conn, account)
        g = _grade(conn, status="running", run=run, claimed="now()")
        entry = _entry(conn, run, g)
        db.unlink_entries_of(conn, [g])

        db.unlink_entries_of(conn, [g])

        assert _link(conn, entry) is None

    def test_a_grade_that_landed_done_keeps_its_place_on_the_board(self, conn, account):
        # The race mark_cancelled exists to win, followed through to the end. The supervisor guards
        # mark_cancelled on status='running', so a report committed in the breath before the kill
        # stays done, and then hands this the WHOLE doomed list. Unlinking that winner would leave
        # the work surviving as a row nothing on the board points at, undoing the race it just won.
        run = _run(conn, account)
        g = _grade(conn, status="running", run=run, claimed="now()")
        entry = _entry(conn, run, g)
        doomed = db.running_on_cancelled_runs(conn) or [g]
        conn.execute("UPDATE grades SET status = 'done', finished_at = now() WHERE id = %s", (g,))
        db.mark_cancelled(conn, g)
        assert _g(conn, g)["status"] == "done"

        db.unlink_entries_of(conn, doomed)

        assert _link(conn, entry) == g

    def test_a_killed_grade_beside_a_finished_one_is_still_unlinked(self, conn, account):
        # The guard is per grade, not per call: one finished sibling must not shelter the rest.
        run = _run(conn, account)
        landed = _grade(conn, status="running", run=run, claimed="now()")
        killed = _grade(conn, origin="https://b.example.com", status="running", run=run, claimed="now()")
        e_landed = _entry(conn, run, landed)
        e_killed = _entry(conn, run, killed, "https://b.example.com")
        conn.execute("UPDATE grades SET status = 'done' WHERE id = %s", (landed,))

        db.unlink_entries_of(conn, [landed, killed])

        assert _link(conn, e_landed) == landed
        assert _link(conn, e_killed) is None
