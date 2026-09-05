"""claim_job: who gets graded next, and who must not be.

This is the single most consequential statement in the worker. It decides ordering between a person
waiting on one grade and an organizer's 400 app field, and it carries the guards that make a pause,
a cancel and an unlinked entry mean something. Every one of those has been wrong at some point.
"""
from __future__ import annotations

import uuid

from sloptic_web_worker import db


def _grade(conn, *, origin="https://a.example.com", status="queued", run=None, submitted="now()", account=None):
    row = conn.execute(
        f"""INSERT INTO grades (origin, submitted_url, mode, status, event_run_id, submitted_at, account_id)
            VALUES (%s, %s, 'passive', %s, %s, {submitted}, %s) RETURNING id""",
        (origin, origin, status, run, account),
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


class TestOrdering:
    def test_takes_the_oldest_queued_grade(self, conn):
        old = _grade(conn, origin="https://old.example.com", submitted="now() - interval '10 minutes'")
        _grade(conn, origin="https://new.example.com")
        assert db.claim_job(conn).id == old

    def test_marks_what_it_took_running_and_stamps_the_clock(self, conn):
        gid = _grade(conn)
        job = db.claim_job(conn)
        row = conn.execute("SELECT status, claimed_at, attempts FROM grades WHERE id = %s", (gid,)).fetchone()
        assert job.id == gid
        assert row["status"] == "running"
        # The elapsed clock on the field counts from here, not from submission: an event grade can
        # sit queued for hours and a timer starting at submitted_at reads as a stuck grade.
        assert row["claimed_at"] is not None
        assert row["attempts"] == 1

    def test_a_person_waiting_on_one_grade_goes_before_an_event_field(self, conn, account):
        run = _run(conn, account)
        for i in range(3):
            g = _grade(conn, origin=f"https://field{i}.example.com", run=run,
                       submitted="now() - interval '1 hour'")
            _entry(conn, run, g, f"https://field{i}.example.com")
        mine = _grade(conn, origin="https://mine.example.com")
        # Submitted an hour later than the whole field and still first: without this a 400 app run
        # takes the worker for a day and every anonymous submission behind it ages out.
        assert db.claim_job(conn).id == mine

    def test_returns_nothing_on_an_empty_queue(self, conn):
        assert db.claim_job(conn) is None


class TestGuards:
    def test_will_not_claim_a_grade_of_a_paused_run(self, conn, account):
        run = _run(conn, account, paused=True)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        assert db.claim_job(conn) is None
        assert conn.execute("SELECT status FROM grades WHERE id=%s", (g,)).fetchone()["status"] == "queued"

    def test_will_not_claim_a_grade_of_a_cancelled_run(self, conn, account):
        run = _run(conn, account, status="cancelled")
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        assert db.claim_job(conn) is None

    def test_will_not_claim_an_event_grade_whose_entry_link_is_gone(self, conn, account):
        # A regrade, a cancel, or a resolver pass can unlink an entry mid-enqueue. The grade is then
        # attached to nothing on the board, so grading it would spend the budget on a report no
        # field points at.
        run = _run(conn, account)
        _grade(conn, run=run)
        assert db.claim_job(conn) is None

    def test_a_paused_run_holds_its_place_rather_than_losing_it(self, conn, account):
        run = _run(conn, account, paused=True)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        db.claim_job(conn)
        conn.execute("UPDATE event_runs SET paused = false WHERE id = %s", (run,))
        assert db.claim_job(conn).id == g


class TestLanes:
    def test_a_spent_event_budget_does_not_stop_a_person_s_own_grade(self, conn, account):
        run = _run(conn, account)
        g = _grade(conn, origin="https://field.example.com", run=run, submitted="now() - interval '1 hour'")
        _entry(conn, run, g, "https://field.example.com")
        mine = _grade(conn, origin="https://mine.example.com")
        assert db.claim_job(conn, lanes={"public"}).id == mine

    def test_a_spent_public_budget_does_not_stop_an_event(self, conn, account):
        run = _run(conn, account)
        g = _grade(conn, origin="https://field.example.com", run=run)
        _entry(conn, run, g, "https://field.example.com")
        _grade(conn, origin="https://mine.example.com")
        assert db.claim_job(conn, lanes={"event"}).id == g

    def test_no_lane_left_means_nothing_is_claimed(self, conn):
        _grade(conn)
        assert db.claim_job(conn, lanes=set()) is None


class TestConcurrency:
    def test_two_workers_never_take_the_same_grade(self, conn, second):
        # The reason the statement uses FOR UPDATE SKIP LOCKED at all. One session cannot skip its
        # own locks, so this needs the second connection to mean anything.
        a = _grade(conn, origin="https://a.example.com")
        b = _grade(conn, origin="https://b.example.com")
        first = db.claim_job(conn)
        other = db.claim_job(second)
        assert {first.id, other.id} == {a, b}
        assert db.claim_job(conn) is None
