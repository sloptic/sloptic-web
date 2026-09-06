"""Who gets told, and who does not.

The selection is the whole feature. Sending is one HTTPS POST; deciding whether to send is where a
200-entry event turns into two hundred messages, or where a suspended account gets mail we said we
would not send it. So these are about pending_notices, not about Resend.
"""
from __future__ import annotations

import pytest

from sloptic_web_worker import db, notify


def _profile(conn, account, *, email="owner@example.com", notify_email=True, suspended=False):
    conn.execute(
        """INSERT INTO profiles (id, email, notify_email, suspended_at)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email,
               notify_email = EXCLUDED.notify_email, suspended_at = EXCLUDED.suspended_at""",
        (account, email, notify_email, "2026-01-01" if suspended else None),
    )


def _grade(conn, account, *, origin="https://a.example", status="done", run=None, slop=12.5):
    row = conn.execute(
        """INSERT INTO grades (origin, submitted_url, mode, status, submitted_at, finished_at,
                               account_id, event_run_id)
           VALUES (%s, %s, 'passive', %s, now(), now(), %s, %s) RETURNING id""",
        (origin, origin, status, account, run),
    ).fetchone()
    gid = str(row["id"])
    if slop is not None and status == "done":
        conn.execute(
            """INSERT INTO results (grade_id, mode, catalog_version, slop_score, axis_slop, coverage)
               VALUES (%s, 'passive', 'test', %s, '{}'::jsonb, '{}'::jsonb)""",
            (gid, slop),
        )
    return gid


def _run(conn, account, *, slug="hack", status="done"):
    row = conn.execute(
        """INSERT INTO event_runs (account_id, slug, mode, status, finished_at)
           VALUES (%s, %s, 'passive', %s, now()) RETURNING id""",
        (account, slug, status),
    ).fetchone()
    return str(row["id"])


class TestWhoIsTold:
    def test_a_finished_grade_with_an_owner(self, conn, account):
        _profile(conn, account)
        gid = _grade(conn, account)

        [n] = db.pending_notices(conn, 10)

        assert n.kind == "grade" and n.id == gid and n.email == "owner@example.com"
        assert n.slop == pytest.approx(12.5)

    def test_a_grade_still_running_is_not(self, conn, account):
        _profile(conn, account)
        _grade(conn, account, status="running", slop=None)

        assert db.pending_notices(conn, 10) == []

    def test_an_anonymous_grade_has_nobody_to_tell(self, conn):
        _grade(conn, None)

        assert db.pending_notices(conn, 10) == []

    def test_an_account_that_opted_out_is_not_told(self, conn, account):
        _profile(conn, account, notify_email=False)
        _grade(conn, account)

        assert db.pending_notices(conn, 10) == []

    def test_a_suspended_account_is_not_told(self, conn, account):
        # Mail is outbound traffic, and a suspension stops us spending it on that account.
        _profile(conn, account, suspended=True)
        _grade(conn, account)

        assert db.pending_notices(conn, 10) == []


class TestAnEventIsOneMessage:
    def test_the_apps_in_a_run_are_never_told_individually(self, conn, account):
        # The property that keeps a 200-entry event from being 200 messages.
        _profile(conn, account)
        run = _run(conn, account, status="grading")
        for i in range(5):
            _grade(conn, account, origin=f"https://e{i}.example", run=run)

        assert [n.kind for n in db.pending_notices(conn, 10)] == []

    def test_the_run_itself_is_told_once_when_it_finishes(self, conn, account):
        _profile(conn, account)
        run = _run(conn, account)
        for i in range(5):
            _grade(conn, account, origin=f"https://e{i}.example", run=run)

        notices = db.pending_notices(conn, 10)

        assert [n.kind for n in notices] == ["run"]
        assert notices[0].id == run


class TestNotTwice:
    def test_marking_removes_it_from_the_queue(self, conn, account):
        _profile(conn, account)
        _grade(conn, account)
        [n] = db.pending_notices(conn, 10)

        db.mark_notified(conn, n)

        assert db.pending_notices(conn, 10) == []

    def test_giving_up_also_removes_it(self, conn, account):
        # A permanently undeliverable address would otherwise be retried every pass for ever.
        _profile(conn, account)
        _grade(conn, account)
        [n] = db.pending_notices(conn, 10)

        db.give_up_notifying(conn, n)

        assert db.pending_notices(conn, 10) == []

    def test_the_batch_is_bounded(self, conn, account):
        _profile(conn, account)
        for i in range(6):
            _grade(conn, account, origin=f"https://x{i}.example")

        assert len(db.pending_notices(conn, 3)) == 3


class TestRendering:
    def test_a_hostname_cannot_inject_markup(self, conn):
        # The origin is a URL a stranger submitted, and it reaches this mail.
        html = notify.render("grade-ready.html",
                             origin="<script>alert(1)</script>", score="12", url="https://x/")

        assert "<script>" not in html
        assert "&lt;script&gt;" in html

    def test_an_unfilled_placeholder_is_refused_rather_than_sent(self):
        with pytest.raises(notify.NotSent):
            notify.render("grade-ready.html", origin="a", score="1")

    def test_sending_is_off_without_a_key(self):
        # A development worker must not mail strangers, and that is a no-op rather than an error.
        assert notify.enabled() is False
        with pytest.raises(notify.NotSent):
            notify.send("a@b.example", "s", "<p>x</p>")
