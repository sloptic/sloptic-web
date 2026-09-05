"""Database policy: retention, the rate limit, and the constraints that carry a rule.

These are the promises the product makes in SQL rather than in Python, which is why they are tested
against a real Postgres. Three of them are load bearing on their own:

  * RETENTION (migration 0009). An anonymous caller may grade an app they do not own, so the stored
    report is a durable inventory of a third party's weaknesses that the third party never asked for.
    Having looked is not the same act as keeping the writeup online forever, so the report body of an
    unclaimed grade expires and the grade row stays. The window is the SQL default, not a constant in
    the application: web/lib/retention.ts says so itself.
  * THE RATE LIMIT (migration 0026). It is the only quota between an anonymous caller and the worker
    fetching a URL of their choosing, so it has to hold against a genuine burst, not just against
    traffic that was already polite. That is a concurrency claim and it needs concurrent sessions.
  * THE CONSTRAINTS. event_runs_override_is_passive (0014, widened by 0019) is the tier model written
    into the table: no debug flag reaches active probing of a stranger's entries. The one-live-run
    index (0025) is an invariant the API used to check with a racy read.

Deletion behaviour gets its own section because what does NOT cascade is deliberate: 0009 sets
grades.account_id to NULL rather than deleting, so rate limiting and abuse history survive an account
deletion.
"""
from __future__ import annotations

import concurrent.futures as cf
import threading
import uuid

import psycopg
import pytest

from sloptic_web_worker import db

# The retention window is the default of expire_anonymous_reports in migration 0009, and that
# migration is the authority (web/lib/retention.ts documents itself as a mirror of it). Restated here
# so a change to the migration fails a test that names the number rather than quietly passing.
RETAIN_DAYS = 30
# forget_submitter_ips' default. Much shorter on purpose: rate limiting looks back hours.
IP_RETAIN_DAYS = 2


# --- local helpers ---------------------------------------------------------------------------------

def _user(conn, email: str) -> str:
    row = conn.execute("INSERT INTO auth.users (email) VALUES (%s) RETURNING id", (email,)).fetchone()
    return str(row["id"])


def _grade(conn, *, origin="https://a.example.com", status="done", account=None, run=None,
           finished="now()", submitted="now()", ip=None):
    row = conn.execute(
        f"""INSERT INTO grades (origin, submitted_url, mode, status, account_id, event_run_id,
                                submitted_at, finished_at, submitter_ip_hash)
            VALUES (%s, %s, 'passive', %s, %s, %s, {submitted}, {finished}, %s) RETURNING id""",
        (origin, origin, status, account, run, ip),
    ).fetchone()
    return str(row["id"])


def _report(conn, grade_id: str) -> None:
    """The report body: what retention takes, as opposed to the grade row, which it keeps."""
    conn.execute(
        """INSERT INTO results (grade_id, catalog_version, slop_score, axis_slop, coverage)
           VALUES (%s, 'sloptic-2.2.0', 12.5, '{"security": 8.5, "qa": 3, "performance": 1}',
                   '{"applied": 44}')""",
        (grade_id,),
    )


def _run(conn, account, *, slug="hack", status="resolving", mode="passive", override=False, admin=False):
    row = conn.execute(
        """INSERT INTO event_runs (account_id, slug, mode, status, override, admin)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
        (account, slug, mode, status, override, admin),
    ).fetchone()
    return str(row["id"])


def _has_report(conn, grade_id: str) -> bool:
    return conn.execute("SELECT 1 FROM results WHERE grade_id = %s", (grade_id,)).fetchone() is not None


def _grade_exists(conn, grade_id: str) -> bool:
    return conn.execute("SELECT 1 FROM grades WHERE id = %s", (grade_id,)).fetchone() is not None


def _expire(conn, days=None) -> int:
    """Call with the SQL default unless a test is deliberately overriding the window."""
    sql = ("SELECT public.expire_anonymous_reports() AS n" if days is None
           else "SELECT public.expire_anonymous_reports(%s) AS n")
    return conn.execute(sql, () if days is None else (days,)).fetchone()["n"]


def _forget(conn, days=None) -> int:
    sql = ("SELECT public.forget_submitter_ips() AS n" if days is None
           else "SELECT public.forget_submitter_ips(%s) AS n")
    return conn.execute(sql, () if days is None else (days,)).fetchone()["n"]


def _bump(conn, ip, window, limit) -> bool:
    return conn.execute(
        "SELECT public.bump_rate_limit(%s, %s, %s) AS ok", (ip, window, limit)
    ).fetchone()["ok"]


def _count(conn, ip, window) -> int:
    row = conn.execute(
        "SELECT count FROM rate_limits WHERE ip_hash = %s AND window_start = %s", (ip, window)
    ).fetchone()
    return row["count"] if row else 0


# --- retention -------------------------------------------------------------------------------------

class TestAnonymousReportRetention:
    def test_takes_the_report_body_of_an_unclaimed_grade_and_keeps_the_grade_row(self, conn):
        # The whole shape of 0009 in one case. The findings list is the part that reads as a
        # weakness inventory for someone else's app, so that is what expires. The grade row is kept
        # because rate limiting, abuse forensics and population statistics need the score, not the
        # findings.
        gid = _grade(conn, finished=f"now() - interval '{RETAIN_DAYS + 1} days'")
        _report(conn, gid)
        assert _expire(conn) == 1
        assert not _has_report(conn, gid)
        assert _grade_exists(conn, gid)

    def test_never_takes_the_report_of_a_grade_an_account_has_claimed(self, conn, account):
        # Claimed grades have no expiry, and that is the whole reason to sign in. Age is irrelevant:
        # a report claimed years ago still stands.
        gid = _grade(conn, account=account, finished="now() - interval '900 days'")
        _report(conn, gid)
        assert _expire(conn) == 0
        assert _has_report(conn, gid)

    def test_keeps_an_unclaimed_report_that_is_still_inside_the_window(self, conn):
        gid = _grade(conn, finished=f"now() - interval '{RETAIN_DAYS} days' + interval '1 hour'")
        _report(conn, gid)
        assert _expire(conn) == 0
        assert _has_report(conn, gid)

    def test_the_window_is_thirty_days_and_the_sql_default_is_the_authority(self, conn):
        # web/lib/retention.ts names 30 too and documents itself as a mirror of this default. Called
        # with no argument on purpose: a test that passed 30 in would agree with itself rather than
        # with the migration.
        just_inside = _grade(conn, origin="https://inside.example.com",
                             finished=f"now() - interval '{RETAIN_DAYS} days' + interval '1 hour'")
        just_outside = _grade(conn, origin="https://outside.example.com",
                              finished=f"now() - interval '{RETAIN_DAYS} days' - interval '1 hour'")
        _report(conn, just_inside)
        _report(conn, just_outside)
        assert _expire(conn) == 1
        assert _has_report(conn, just_inside)
        assert not _has_report(conn, just_outside)

    def test_never_takes_the_report_of_a_grade_that_has_not_finished(self, conn):
        # finished_at is the clock, not submitted_at. A grade that has sat queued behind a 400 app
        # field for longer than the window has not published anything about anyone yet, and a sweep
        # keyed off submission would delete the report the moment it was written.
        gid = _grade(conn, status="running", submitted="now() - interval '400 days'", finished="NULL")
        _report(conn, gid)
        assert _expire(conn) == 0
        assert _has_report(conn, gid)

    def test_reports_how_many_bodies_it_dropped(self, conn):
        for i in range(3):
            gid = _grade(conn, origin=f"https://g{i}.example.com",
                         finished=f"now() - interval '{RETAIN_DAYS + 5} days'")
            _report(conn, gid)
        assert _expire(conn) == 3

    def test_is_safe_to_run_again_and_finds_nothing_the_second_time(self, conn):
        # The worker calls this on every maintenance tick, so a second pass over a clear backlog has
        # to be a no-op rather than an error or a repeated count.
        gid = _grade(conn, finished=f"now() - interval '{RETAIN_DAYS + 1} days'")
        _report(conn, gid)
        assert _expire(conn) == 1
        assert _expire(conn) == 0

    def test_an_explicit_window_overrides_the_default(self, conn):
        # The parameter exists so an operator can sweep harder in an incident. A report inside the
        # 30 day default goes when the caller asks for 7.
        gid = _grade(conn, finished="now() - interval '10 days'")
        _report(conn, gid)
        assert _expire(conn) == 0
        assert _expire(conn, 7) == 1

    def test_leaves_a_grade_that_never_produced_a_report_alone(self, conn):
        # A failed grade has no results row. The sweep must not count it or error on it.
        gid = _grade(conn, status="failed", finished=f"now() - interval '{RETAIN_DAYS + 1} days'")
        assert _expire(conn) == 0
        assert _grade_exists(conn, gid)


class TestForgettingSubmitterIps:
    def test_forgets_a_hash_older_than_two_days(self, conn):
        gid = _grade(conn, ip="deadbeef", submitted=f"now() - interval '{IP_RETAIN_DAYS + 1} days'")
        assert _forget(conn) == 1
        assert conn.execute(
            "SELECT submitter_ip_hash FROM grades WHERE id = %s", (gid,)
        ).fetchone()["submitter_ip_hash"] is None

    def test_keeps_a_hash_the_rate_limiter_might_still_want(self, conn):
        # The window the application uses is an hour (RATE_LIMIT_WINDOW_SECONDS defaults to 3600), so
        # a hash from a few hours ago is still inside the purpose it was collected for.
        gid = _grade(conn, ip="deadbeef", submitted="now() - interval '3 hours'")
        assert _forget(conn) == 0
        assert conn.execute(
            "SELECT submitter_ip_hash FROM grades WHERE id = %s", (gid,)
        ).fetchone()["submitter_ip_hash"] == "deadbeef"

    def test_forgets_the_ip_hash_well_before_it_takes_the_report(self, conn):
        # The ordering 0009 states outright: the hashed IP is the only quasi-identifier in the schema
        # and it outlives its purpose fast, so it goes long before the report does. Three days in,
        # the identifier is gone and the report is still there.
        gid = _grade(conn, ip="deadbeef", submitted="now() - interval '3 days'",
                     finished="now() - interval '3 days'")
        _report(conn, gid)
        _forget(conn)
        _expire(conn)
        row = conn.execute("SELECT submitter_ip_hash FROM grades WHERE id = %s", (gid,)).fetchone()
        assert row["submitter_ip_hash"] is None
        assert _has_report(conn, gid)

    def test_forgets_the_hash_of_a_claimed_grade_too(self, conn, account):
        # Signing in buys the report an indefinite life, not the submitter's address one. Retention
        # of the report and retention of the identifier are separate policies with separate windows.
        gid = _grade(conn, account=account, ip="deadbeef",
                     submitted=f"now() - interval '{IP_RETAIN_DAYS + 1} days'")
        assert _forget(conn) == 1
        assert conn.execute(
            "SELECT submitter_ip_hash FROM grades WHERE id = %s", (gid,)
        ).fetchone()["submitter_ip_hash"] is None

    def test_is_safe_to_run_again_and_finds_nothing_the_second_time(self, conn):
        _grade(conn, ip="deadbeef", submitted=f"now() - interval '{IP_RETAIN_DAYS + 1} days'")
        assert _forget(conn) == 1
        assert _forget(conn) == 0

    def test_an_explicit_window_overrides_the_default(self, conn):
        _grade(conn, ip="deadbeef", submitted="now() - interval '6 hours'")
        assert _forget(conn) == 0
        assert _forget(conn, 0) == 1


class TestTheMaintenanceSweep:
    def test_the_sweep_runs_both_policies_on_their_own_sql_defaults(self, conn):
        # sweep_retention deliberately passes no arguments: the windows live in migration 0009 and
        # the worker restating them would be a second, drifting copy of the policy.
        stale_ip = _grade(conn, origin="https://ip.example.com", ip="deadbeef",
                          submitted=f"now() - interval '{IP_RETAIN_DAYS + 1} days'")
        old = _grade(conn, origin="https://old.example.com",
                     finished=f"now() - interval '{RETAIN_DAYS + 1} days'")
        _report(conn, old)
        dropped, forgotten = db.sweep_retention(conn)
        assert (dropped, forgotten) == (1, 1)
        assert not _has_report(conn, old)
        assert conn.execute(
            "SELECT submitter_ip_hash FROM grades WHERE id = %s", (stale_ip,)
        ).fetchone()["submitter_ip_hash"] is None

    def test_the_sweep_keeps_every_grade_row_it_touched(self, conn):
        # It is a maintenance tick that runs unattended every minute. If it could delete grades, an
        # off by one in the window would quietly destroy the population statistics and the abuse
        # trail rather than just a report body.
        old = _grade(conn, finished=f"now() - interval '{RETAIN_DAYS + 90} days'",
                     submitted=f"now() - interval '{RETAIN_DAYS + 90} days'", ip="deadbeef")
        _report(conn, old)
        db.sweep_retention(conn)
        assert _grade_exists(conn, old)

    def test_the_sweep_is_a_no_op_on_a_clear_backlog(self, conn):
        assert db.sweep_retention(conn) == (0, 0)


# --- the rate limit --------------------------------------------------------------------------------

WINDOW = "2026-01-01 00:00:00+00"
LATER_WINDOW = "2026-01-01 01:00:00+00"


class TestRateLimit:
    def test_allows_exactly_the_limit_and_then_refuses(self, conn):
        # bump_rate_limit charges the request first and then answers, so a limit of 5 means five
        # allowed calls, the fifth included, and the sixth refused.
        verdicts = [_bump(conn, "ip", WINDOW, 5) for _ in range(6)]
        assert verdicts == [True, True, True, True, True, False]

    def test_counts_the_refused_attempt_as_well(self, conn):
        # Stated in 0026: a caller who keeps submitting past the limit is exactly who the window is
        # for, and not counting them would make the window cheaper to sit out the harder it is pushed.
        for _ in range(8):
            _bump(conn, "ip", WINDOW, 5)
        assert _count(conn, "ip", WINDOW) == 8

    def test_stays_refused_once_the_window_is_spent(self, conn):
        for _ in range(5):
            _bump(conn, "ip", WINDOW, 5)
        assert _bump(conn, "ip", WINDOW, 5) is False
        assert _bump(conn, "ip", WINDOW, 5) is False

    def test_a_new_window_starts_the_count_over(self, conn):
        for _ in range(6):
            _bump(conn, "ip", WINDOW, 5)
        assert _bump(conn, "ip", LATER_WINDOW, 5) is True
        assert _count(conn, "ip", LATER_WINDOW) == 1

    def test_one_address_spending_its_window_does_not_touch_another(self, conn):
        # The key is (ip_hash, window_start). A shared counter would let one abusive caller lock out
        # everyone behind the same edge node.
        for _ in range(6):
            _bump(conn, "noisy", WINDOW, 5)
        assert _bump(conn, "quiet", WINDOW, 5) is True

    def test_a_limit_of_zero_refuses_the_very_first_request(self, conn):
        # The application fails closed when it cannot reach the database (web/lib/ratelimit.ts), and
        # a zero limit is the same intent expressed through the function: no request is free.
        assert _bump(conn, "ip", WINDOW, 0) is False
        assert _count(conn, "ip", WINDOW) == 1


class TestRateLimitUnderConcurrency:
    """The reason bump_rate_limit exists at all.

    allow() used to read the counter, await, then write it back, so a dozen simultaneous submissions
    from one address all read the same count and all passed. These cases need genuinely concurrent
    sessions: a single session cannot race itself, and a serial loop passes against the broken
    read-modify-write just as happily as against the fixed one.
    """

    @staticmethod
    def _burst(url, *, ip, window, limit, n):
        """Fire n calls from n separate connections, released together."""
        ready = threading.Barrier(n)

        def one():
            with psycopg.connect(url, autocommit=True) as c:
                # Connect BEFORE lining up at the barrier: releasing into a TCP handshake would
                # stagger the calls and the burst would not overlap.
                ready.wait(timeout=30)
                return c.execute(
                    "SELECT public.bump_rate_limit(%s, %s, %s)", (ip, window, limit)
                ).fetchone()[0]

        with cf.ThreadPoolExecutor(max_workers=n) as pool:
            return [f.result() for f in [pool.submit(one) for _ in range(n)]]

    def test_a_simultaneous_burst_gets_no_more_through_than_the_limit(self, conn, schema):
        # Twelve at once against a limit of five, the exact scenario 0026 was written for.
        verdicts = self._burst(schema, ip="burst", window=WINDOW, limit=5, n=12)
        assert sum(verdicts) == 5, "a concurrent burst got past the limit: the increment is not atomic"
        assert _count(conn, "burst", WINDOW) == 12, "the refused attempts in the burst were not counted"

    def test_no_increment_in_a_burst_is_lost(self, conn, schema):
        # Separate from the verdict count: even with a limit high enough that everyone is allowed,
        # every call must land. A lost update here would show up later as a window that never fills.
        self._burst(schema, ip="counted", window=WINDOW, limit=1000, n=12)
        assert _count(conn, "counted", WINDOW) == 12

    def test_a_burst_from_many_addresses_does_not_interfere(self, conn, schema):
        # Rows for different addresses are different rows, so they must not serialise behind each
        # other, and none of them may steal another's count.
        def one(i):
            with psycopg.connect(schema, autocommit=True) as c:
                return c.execute(
                    "SELECT public.bump_rate_limit(%s, %s, %s)", (f"addr{i}", WINDOW, 1)
                ).fetchone()[0]

        with cf.ThreadPoolExecutor(max_workers=8) as pool:
            verdicts = list(pool.map(one, range(8)))
        assert all(verdicts)
        for i in range(8):
            assert _count(conn, f"addr{i}", WINDOW) == 1

    def test_a_second_caller_waits_for_the_row_rather_than_reading_a_stale_count(self, conn, second):
        # The mechanism, made visible. INSERT ON CONFLICT DO UPDATE takes a row lock, so a concurrent
        # caller blocks until the first transaction ends instead of reading the pre-increment value.
        # A statement timeout is used to observe the block without hanging the suite.
        second.autocommit = False
        try:
            assert _bump(second, "locked", WINDOW, 5) is True  # holds the row, uncommitted
            conn.execute("SET statement_timeout = '500ms'")
            with pytest.raises(psycopg.errors.QueryCanceled):
                _bump(conn, "locked", WINDOW, 5)
        finally:
            conn.execute("SET statement_timeout = 0")
            second.rollback()
            second.autocommit = True
        # The blocked caller saw nothing, and the rolled back one left nothing behind.
        assert _count(conn, "locked", WINDOW) == 0


# --- one live run per event per account --------------------------------------------------------------

LIVE = ("resolving", "ready", "grading")
FINISHED = ("done", "failed", "cancelled")


class TestOneLiveRunIndex:
    def test_refuses_a_second_live_run_for_the_same_account_and_slug(self, conn, account):
        # The API checked for this first, but a check then insert races with itself (two tabs, a
        # double submit), and the check used maybeSingle(), which returns nothing once a duplicate
        # exists, so the first duplicate let every later one through. This is the invariant made the
        # table's own.
        _run(conn, account, slug="hack", status="grading")
        with pytest.raises(psycopg.errors.UniqueViolation):
            _run(conn, account, slug="hack", status="resolving")

    @pytest.mark.parametrize("first", LIVE)
    @pytest.mark.parametrize("secondstatus", LIVE)
    def test_every_live_status_blocks_every_other_live_status(self, conn, account, first, secondstatus):
        # Resolving, ready and grading are all in flight in different ways, and any pair of them on
        # one slug is two boards for one event.
        _run(conn, account, slug="hack", status=first)
        with pytest.raises(psycopg.errors.UniqueViolation):
            _run(conn, account, slug="hack", status=secondstatus)

    def test_permits_many_finished_runs_alongside_one_live_run(self, conn, account):
        # History is the point of a partial index here: an organizer regrades the same event across a
        # weekend and every previous board must survive.
        for i, status in enumerate(FINISHED * 3):
            _run(conn, account, slug="hack", status=status)
        _run(conn, account, slug="hack", status="grading")
        assert conn.execute(
            "SELECT count(*) AS n FROM event_runs WHERE slug = 'hack'"
        ).fetchone()["n"] == len(FINISHED) * 3 + 1

    def test_the_same_slug_under_a_different_account_is_a_different_run(self, conn, account):
        # The index is (account_id, slug), not (slug). Two organizers, or an organizer and an
        # operator override, may each hold a live board for the same public event.
        other = _user(conn, "other@example.com")
        _run(conn, account, slug="hack", status="grading")
        _run(conn, other, slug="hack", status="grading")

    def test_one_account_may_hold_live_runs_for_different_events(self, conn, account):
        _run(conn, account, slug="hack-one", status="grading")
        _run(conn, account, slug="hack-two", status="grading")

    def test_finishing_the_live_run_frees_the_slug_again(self, conn, account):
        run = _run(conn, account, slug="hack", status="grading")
        with pytest.raises(psycopg.errors.UniqueViolation):
            _run(conn, account, slug="hack", status="resolving")
        conn.execute("UPDATE event_runs SET status = 'cancelled' WHERE id = %s", (run,))
        _run(conn, account, slug="hack", status="resolving")

    def test_reviving_a_finished_run_cannot_produce_a_second_live_one(self, conn, account):
        # The index constrains UPDATE as well as INSERT, which is what stops a retry path from
        # flipping an old board back to grading beside the current one.
        old = _run(conn, account, slug="hack", status="done")
        _run(conn, account, slug="hack", status="grading")
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute("UPDATE event_runs SET status = 'grading' WHERE id = %s", (old,))

    def test_a_paused_run_still_counts_as_live(self, conn, account):
        # Pause stops the worker claiming the run's grades; it does not end the run. Letting a second
        # board start beside a paused one would be the same duplicate by another route.
        _run(conn, account, slug="hack", status="grading")
        conn.execute("UPDATE event_runs SET paused = true WHERE slug = 'hack'")
        with pytest.raises(psycopg.errors.UniqueViolation):
            _run(conn, account, slug="hack", status="ready")


# --- constraints -----------------------------------------------------------------------------------

class TestOverrideRunsStayPassive:
    def test_an_override_run_cannot_be_active_without_the_admin_flag(self, conn, account):
        # The tier model in the table. An override run skipped the organizer ownership check, so
        # sending the active battery at its entries is active probing of a stranger's apps, which is
        # the unauthorized testing the whole tier model exists to prevent. No debug flag reaches it.
        with pytest.raises(psycopg.errors.CheckViolation):
            _run(conn, account, mode="active", override=True, admin=False)

    def test_an_override_run_may_be_active_only_under_operator_admin(self, conn, account):
        # 0019's one named exception, recorded as its own column so a board built this way stays
        # distinguishable from an organizer-authorized one forever.
        run = _run(conn, account, mode="active", override=True, admin=True)
        row = conn.execute("SELECT override, admin, mode FROM event_runs WHERE id = %s", (run,)).fetchone()
        assert (row["override"], row["admin"], row["mode"]) == (True, True, "active")

    def test_a_passive_override_run_is_fine_with_or_without_admin(self, conn, account):
        _run(conn, account, slug="one", mode="passive", override=True, admin=False)
        _run(conn, account, slug="two", mode="passive", override=True, admin=True)

    def test_a_run_that_skipped_no_check_is_unconstrained(self, conn, account):
        # The organizer-verified path: not an override at all, so the constraint has nothing to say
        # and an active board is exactly what a grant buys.
        _run(conn, account, mode="active", override=False, admin=False)

    def test_a_passive_override_run_cannot_be_promoted_to_active_later(self, conn, account):
        # The realistic bypass is not the INSERT, it is an UPDATE after the fact. A check constraint
        # covers both, which is why this is in the table rather than only in the route.
        run = _run(conn, account, mode="passive", override=True)
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE event_runs SET mode = 'active' WHERE id = %s", (run,))

    def test_admin_cannot_be_dropped_from_an_active_override_run(self, conn, account):
        # The other direction of the same UPDATE hole: clearing admin on an active override run would
        # leave a row that could never have been inserted.
        run = _run(conn, account, mode="active", override=True, admin=True)
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE event_runs SET admin = false WHERE id = %s", (run,))


class TestStatusAndModeConstraints:
    def test_a_grade_may_be_cancelled_which_is_not_the_same_as_failed(self, conn):
        # 0024 widened the status check for exactly this: "failed" would be a lie about who stopped
        # the grade, and the board has to be able to say the organizer did.
        gid = _grade(conn, status="queued")
        conn.execute("UPDATE grades SET status = 'cancelled' WHERE id = %s", (gid,))
        assert conn.execute(
            "SELECT status FROM grades WHERE id = %s", (gid,)
        ).fetchone()["status"] == "cancelled"

    @pytest.mark.parametrize("status", ["queued", "running", "done", "failed", "cancelled"])
    def test_every_status_the_worker_writes_is_accepted(self, conn, status):
        _grade(conn, origin=f"https://{status}.example.com", status=status)

    def test_an_unknown_grade_status_is_refused(self, conn):
        # The poll route and the board both branch on this string. A typo that reached the column
        # would render as neither finished nor in flight.
        with pytest.raises(psycopg.errors.CheckViolation):
            _grade(conn, status="complete")

    def test_a_grade_is_passive_or_active_and_nothing_else(self, conn):
        # The two tiers rank on different curves, so a third value would be a measurement with no
        # population to place it against.
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                "INSERT INTO grades (origin, submitted_url, mode) VALUES ('x', 'x', 'full')"
            )

    def test_an_unknown_run_status_is_refused(self, conn, account):
        with pytest.raises(psycopg.errors.CheckViolation):
            _run(conn, account, status="finished")

    def test_a_run_is_passive_or_active_and_nothing_else(self, conn, account):
        # One tier per run, decided when it starts and never mixed: a board with some entries on 44
        # checks and others on 102 is two measurements in one column.
        with pytest.raises(psycopg.errors.CheckViolation):
            _run(conn, account, mode="mixed")

    def test_a_grant_is_one_of_the_two_kinds_that_have_a_proof_flow(self, conn, account):
        # app_origin is proven by the file token plus the DNS TXT record, organizer_event by the
        # token link in the event rules. A kind with no proof flow behind it would be an
        # authorization nobody ever earned.
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                """INSERT INTO grants (account_id, kind, scope, expires_at)
                   VALUES (%s, 'platform_subdomain', 'x.vercel.app', now() + interval '90 days')""",
                (account,),
            )


# --- what cascades and what is deliberately kept ------------------------------------------------------

class TestDeletionBehaviour:
    def test_deleting_an_account_keeps_its_grades_and_reverts_them_to_anonymous(self, conn, account):
        # 0009 chose SET NULL over CASCADE on purpose: deleting an account must not silently destroy
        # the rate limiting and abuse history attached to grades it once claimed. Someone who graded
        # a hundred strangers' apps and then deleted the account should not thereby erase the trail.
        gid = _grade(conn, account=account, ip="deadbeef")
        conn.execute("DELETE FROM auth.users WHERE id = %s", (account,))
        row = conn.execute("SELECT account_id, submitter_ip_hash FROM grades WHERE id = %s", (gid,)).fetchone()
        assert row is not None, "an account deletion took the grade row with it"
        assert row["account_id"] is None
        assert row["submitter_ip_hash"] == "deadbeef"

    def test_a_grade_orphaned_by_an_account_deletion_becomes_reachable_by_the_sweep(self, conn, account):
        # The other half of that choice. The grades revert to anonymous, which means their reports go
        # on the normal schedule rather than living forever as the property of an account that no
        # longer exists.
        gid = _grade(conn, account=account, finished=f"now() - interval '{RETAIN_DAYS + 1} days'")
        _report(conn, gid)
        assert _expire(conn) == 0  # claimed, so out of reach
        conn.execute("DELETE FROM auth.users WHERE id = %s", (account,))
        assert _expire(conn) == 1
        assert _grade_exists(conn, gid)

    def test_deleting_an_account_takes_its_grants_with_it(self, conn, account):
        # A grant is account-bound by construction: it says "this account may actively grade this
        # scope", never "this scope is open". With the account gone the sentence has no subject, so
        # the row must not survive to be read as a property of the origin.
        conn.execute(
            """INSERT INTO grants (account_id, kind, scope, expires_at)
               VALUES (%s, 'app_origin', 'https://alice.com', now() + interval '90 days')""",
            (account,),
        )
        conn.execute("DELETE FROM auth.users WHERE id = %s", (account,))
        assert conn.execute("SELECT count(*) AS n FROM grants").fetchone()["n"] == 0

    def test_deleting_an_account_takes_its_profile_and_its_runs_and_entries(self, conn, account):
        conn.execute("INSERT INTO profiles (id, email) VALUES (%s, 'organizer@example.com')", (account,))
        run = _run(conn, account)
        conn.execute(
            "INSERT INTO event_entries (run_id, project_url, app_url) VALUES (%s, 'p', 'a')", (run,)
        )
        conn.execute("DELETE FROM auth.users WHERE id = %s", (account,))
        assert conn.execute("SELECT count(*) AS n FROM profiles").fetchone()["n"] == 0
        assert conn.execute("SELECT count(*) AS n FROM event_runs").fetchone()["n"] == 0
        assert conn.execute("SELECT count(*) AS n FROM event_entries").fetchone()["n"] == 0

    def test_deleting_an_account_keeps_the_grades_its_runs_produced(self, conn, account):
        # The run and its board go, the measurements do not. Those grades are still part of the
        # population and still the abuse record for traffic this service actually sent.
        run = _run(conn, account)
        gid = _grade(conn, run=run)
        conn.execute("DELETE FROM auth.users WHERE id = %s", (account,))
        row = conn.execute("SELECT event_run_id FROM grades WHERE id = %s", (gid,)).fetchone()
        assert row is not None
        assert row["event_run_id"] is None

    def test_deleting_a_grade_takes_its_report_with_it(self, conn):
        # results hangs off grades one to one, so a grade row with an orphan report would be a
        # findings list nothing can attribute or expire.
        gid = _grade(conn)
        _report(conn, gid)
        conn.execute("DELETE FROM grades WHERE id = %s", (gid,))
        assert conn.execute("SELECT count(*) AS n FROM results").fetchone()["n"] == 0

    def test_deleting_a_grade_unlinks_the_entry_rather_than_deleting_it(self, conn, account):
        # The entry is the team's row on the board and its consent chain, so it outlives any one
        # attempt at grading it. Clearing the link is also what makes that app gradeable again, which
        # is exactly what cancel relies on.
        run = _run(conn, account)
        gid = _grade(conn, run=run)
        conn.execute(
            "INSERT INTO event_entries (run_id, project_url, app_url, grade_id) VALUES (%s, 'p', 'a', %s)",
            (run, gid),
        )
        conn.execute("DELETE FROM grades WHERE id = %s", (gid,))
        row = conn.execute("SELECT grade_id FROM event_entries").fetchone()
        assert row is not None, "deleting a grade deleted the entry the board is built from"
        assert row["grade_id"] is None

    def test_deleting_a_run_keeps_its_grades_and_drops_its_entries(self, conn, account):
        run = _run(conn, account)
        gid = _grade(conn, run=run)
        conn.execute(
            "INSERT INTO event_entries (run_id, project_url, app_url, grade_id) VALUES (%s, 'p', 'a', %s)",
            (run, gid),
        )
        conn.execute("DELETE FROM event_runs WHERE id = %s", (run,))
        assert _grade_exists(conn, gid)
        assert conn.execute("SELECT count(*) AS n FROM event_entries").fetchone()["n"] == 0

    def test_a_grade_cannot_name_an_account_that_does_not_exist(self, conn):
        # The account binding is a real foreign key, not a convention. If it were not, a forged
        # account_id would make a report unreachable by retention and falsely attributed.
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            _grade(conn, account=str(uuid.uuid4()))


class TestFunctionPrivileges:
    def test_the_policy_functions_are_executable_by_the_service_role(self, conn):
        # The web API calls bump_rate_limit over PostgREST as service_role, and the worker calls the
        # retention pair. Both are SECURITY DEFINER so they act with the owner's rights regardless of
        # who calls, which is what makes the grants below the only access control on them.
        for fn in ("expire_anonymous_reports", "forget_submitter_ips", "bump_rate_limit"):
            assert conn.execute(
                "SELECT has_function_privilege('service_role', p.oid, 'EXECUTE') AS ok "
                "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'public' AND p.proname = %s",
                (fn,),
            ).fetchone()["ok"]

    def test_the_policy_functions_are_not_executable_by_the_browser_s_key(self, conn):
        """The one that mattered, kept as a regression test.

        Postgres grants EXECUTE on a new function to PUBLIC by default, and the migrations that
        created these only ever added the service_role grant, so nobody wrote a revoke. anon
        inherits PUBLIC, anon is the role behind the publishable key in the client bundle, and
        PostgREST mounts every public-schema function at /rest/v1/rpc/<name>. All three are SECURITY
        DEFINER, so RLS does not apply to what they do.

        It was reachable in production: an anonymous POST to /rest/v1/rpc/bump_rate_limit answered
        200. expire_anonymous_reports takes its window as a caller-supplied argument and deletes
        rows, so a negative retain_days would have destroyed every unclaimed report on the service.
        Migration 0028 revokes all three and sets default privileges so the next function starts
        closed.
        """
        for fn in ("expire_anonymous_reports", "forget_submitter_ips", "bump_rate_limit"):
            for role in ("anon", "authenticated"):
                assert not conn.execute(
                    "SELECT has_function_privilege(%s, p.oid, 'EXECUTE') AS ok "
                    "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                    "WHERE n.nspname = 'public' AND p.proname = %s",
                    (role, fn),
                ).fetchone()["ok"], (
                    f"{fn} is executable by {role}: the browser key can call it over PostgREST"
                )

    def test_no_function_in_the_public_schema_is_executable_by_anon(self, conn):
        """The durable half, and it is a test rather than a schema setting because there is no

        schema setting that does it. ALTER DEFAULT PRIVILEGES cannot revoke the built-in PUBLIC
        EXECUTE on functions: the revoke records nothing, and a new function still carries `=X`.
        So the only thing that stops the next function shipping open is something that looks at all
        of them, which is this.

        Extension functions are excluded: pgcrypto installs into public and is PUBLIC-executable by
        design, and that is not ours to change.
        """
        open_to_anon = conn.execute(
            """
            SELECT p.proname, p.pronargs
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND NOT EXISTS (
                     SELECT 1 FROM pg_depend d
                      WHERE d.objid = p.oid AND d.deptype = 'e')
               AND has_function_privilege('anon', p.oid, 'EXECUTE')
             ORDER BY 1
            """
        ).fetchall()
        assert not open_to_anon, (
            "these functions are callable by the browser key over PostgREST at /rest/v1/rpc: "
            + ", ".join(r["proname"] for r in open_to_anon)
            + ". Revoke execute from public and grant it to service_role, as migration 0028 does."
        )
