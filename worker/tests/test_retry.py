"""Challenge recovery: re-running the probe tail a WAF stopped, without ever digging at the WAF.

A bot challenge does not fail a grade, it truncates it (0018, 0020). The probes that never ran sit in
results.blocked_probes and read as N/A, which is lost recall wearing the clothes of a clean result. The
recovery is a SECOND PASS over just those ids once the block has cleared, folded back onto the same
grade, and the columns it leaves behind (retry_due_at, retry_passes, retry_blocked_initial,
blocked_probes) are exactly what the board turns into the B / N / P / F marks.

Everything here is bounded on purpose. CLAUDE.md: "Rate-limit + quota every grade. Respect robots and
bot-challenges; never build anything that defeats them." A pass is recovery from a transient block, so
it waits for the block to clear, it happens a fixed small number of times, and a pause or a cancel
stops it exactly as it stops a queued grade. A retry loop that could not end would be a slow crawler
aimed at somebody's app.
"""
from __future__ import annotations

import pytest

from sloptic_web_worker import config, db, grader

MAX = config.RETRY_BLOCKED_MAX_PASSES


# --- rows ---------------------------------------------------------------------------------------

def _grade(conn, *, origin="https://a.example.com", status="done", run=None, account=None,
           mode="passive", passes=0):
    row = conn.execute(
        """INSERT INTO grades (origin, submitted_url, mode, status, event_run_id, submitted_at,
                               account_id, retry_passes)
           VALUES (%s, %s, %s, %s, %s, now(), %s, %s) RETURNING id""",
        (origin, origin, mode, status, run, account, passes),
    ).fetchone()
    return str(row["id"])


def _result(conn, grade, *, blocked=(), mode="passive", slop=0, initial=None, stage=None):
    """A stored grade record. claim_retry only looks at a grade that HAS one, since a pass with no
    result to fold into would have nowhere to put what it recovered."""
    conn.execute(
        """INSERT INTO results (grade_id, mode, catalog_version, slop_score, axis_slop, coverage,
                                blocked_probes, bot_challenge, challenge_stage, retry_blocked_initial)
           VALUES (%s, %s, 'sloptic-test', %s, '{}'::jsonb, '{}'::jsonb, %s, %s, %s, %s)""",
        (grade, mode, slop, list(blocked), bool(blocked), stage, initial),
    )


def _run(conn, account, *, status="grading", paused=False, slug="hack"):
    row = conn.execute(
        """INSERT INTO event_runs (account_id, slug, mode, status, paused)
           VALUES (%s, %s, 'passive', %s, %s) RETURNING id""",
        (account, slug, status, paused),
    ).fetchone()
    return str(row["id"])


def _entry(conn, run, grade, url="https://a.example.com"):
    conn.execute(
        "INSERT INTO event_entries (run_id, project_url, app_url, grade_id) VALUES (%s, %s, %s, %s)",
        (run, url, url, grade),
    )


def _book(conn, grade, blocked=("sec-inj-001",), *, delay=-60.0, max_passes=None):
    """Book a pass through the real entry point. A negative delay books it in the past, which is what
    "already due" means to the claim."""
    return db.schedule_retry(conn, grade, list(blocked), delay,
                             MAX if max_passes is None else max_passes)


def _row(conn, grade):
    return conn.execute(
        "SELECT retry_passes, retry_due_at, (retry_due_at - now()) AS wait FROM grades WHERE id = %s",
        (grade,),
    ).fetchone()


def _wait_seconds(conn, grade) -> float:
    """How long from now until the booked pass, in seconds."""
    return _row(conn, grade)["wait"].total_seconds()


def _marks(*, retry_due_at, retry_passes, initial, blocked):
    """The board's recovery marks, mirroring recoveryMarks in web/lib/grades.ts.

    Kept here rather than imported (it is TypeScript) because the worker's columns are the INPUT to
    it: the point of the merge tests is that what the worker writes produces the right letter.
    B = a pass is still pending, N = recovered nothing, P = partial, F = the tail came back.
    """
    pending = bool(retry_due_at)
    recovered = max(0, (initial or 0) - (blocked or 0))
    done = not pending and (retry_passes or 0) > 0 and (initial or 0) > 0
    return {
        "retry": pending,
        "none": done and recovered == 0,
        "partial": done and 0 < recovered < (initial or 0),
        "full": done and recovered >= (initial or 0),
    }


# --- outcome records for the merge --------------------------------------------------------------

def _outcome(pid, *, outcome="clean", penalty=0, bundle="security", category="headers"):
    return {"probe_id": pid, "bundle": bundle, "category": category, "outcome": outcome,
            "penalty": penalty, "variant_group_id": None, "target": "", "reason": "", "evidence": {}}


def _finding(pid, *, penalty=10, bundle="security", category="headers"):
    return {"probe_id": pid, "bundle": bundle, "category": category, "penalty": penalty,
            "group": None, "reason": "fired", "target": "", "evidence": {}}


@pytest.fixture()
def no_curve(monkeypatch):
    """No percentile during a merge, so these assertions are about the merge and not about whichever
    curve files happen to be on this box. rank() returning None is an ordinary state: a missing curve
    means no percentile, never a wrong one."""
    monkeypatch.setattr(grader.ranking, "rank_passive", lambda *a, **k: None)
    monkeypatch.setattr(grader.ranking, "rank_full", lambda *a, **k: None)
    monkeypatch.setattr(grader.ranking, "load_curve", lambda *a, **k: None)


class TestTheCooldownConstants:
    """Three different clocks, confused before. The first wait is for the block to clear, the second
    is the escalated wait after a pass ran into it again, and the claim lock is neither: it is how
    long a claimed pass stays invisible to other workers."""

    def test_the_first_wait_is_long_enough_for_the_block_to_clear(self):
        # Vercel's per-app block clears in roughly ten minutes. Coming back sooner is not recovery,
        # it is digging at a challenge that is still up, which CLAUDE.md forbids outright.
        assert config.RETRY_BLOCKED_DELAY_SECONDS >= 600

    def test_the_second_wait_is_longer_than_the_first(self):
        # A pass that re-tripped the block is evidence the block outlasts the first cooldown, so the
        # next wait escalates rather than repeating.
        assert config.RETRY_BLOCKED_NEXT_DELAY_SECONDS > config.RETRY_BLOCKED_DELAY_SECONDS

    def test_the_ceiling_is_a_small_finite_number_of_passes(self):
        assert 1 <= config.RETRY_BLOCKED_MAX_PASSES <= 5

    def test_the_claim_lock_outlives_the_longest_a_pass_can_run(self):
        # The lock is a visibility lock: while it holds, no other worker may take the same grade. If
        # it expired before the pass could be killed, two workers would probe one app at once.
        assert config.RETRY_CLAIM_LOCK_SECONDS >= config.GRADE_TIMEOUT_SECONDS

    def test_the_claim_lock_is_not_the_next_attempt_delay(self):
        # These have been confused. The lock is measured against a pass in flight, the delay against
        # a block that has to clear, and a lock shorter than the cooldown would hand the grade back
        # out mid-pass.
        assert config.RETRY_CLAIM_LOCK_SECONDS > config.RETRY_BLOCKED_NEXT_DELAY_SECONDS


class TestBookingAPass:
    def test_books_a_pass_when_a_challenge_left_probes_unrun(self, conn):
        g = _grade(conn)
        assert db.schedule_retry(conn, g, ["sec-inj-001", "sec-inj-002"], 720.0, MAX) is True
        assert 700 < _wait_seconds(conn, g) < 740

    def test_books_nothing_when_the_grade_ran_its_whole_battery(self, conn):
        # The ordinary case by far. A grade with an empty blocked tail has nothing to recover, and
        # sending it back at the app anyway would be traffic bought for no signal.
        g = _grade(conn)
        assert db.schedule_retry(conn, g, [], 720.0, MAX) is False
        assert _row(conn, g)["retry_due_at"] is None

    def test_booking_does_not_itself_spend_a_pass(self, conn):
        # The counter belongs to the claim, not the booking: a booked pass that is never claimed
        # (paused run, cancelled run, worker down) must not consume the app's recovery budget.
        g = _grade(conn)
        _book(conn, g)
        assert _row(conn, g)["retry_passes"] == 0

    def test_refuses_to_book_once_the_passes_are_spent(self, conn):
        g = _grade(conn, passes=MAX)
        assert _book(conn, g) is False
        assert _row(conn, g)["retry_due_at"] is None

    def test_still_books_while_a_pass_remains(self, conn):
        g = _grade(conn, passes=MAX - 1)
        assert _book(conn, g) is True

    def test_a_rebooking_measures_the_wait_from_now(self, conn):
        # After a pass that re-tripped the block, the wait covers the block the pass just met, so it
        # starts now rather than resuming a countdown that began before the pass ran.
        g = _grade(conn)
        _book(conn, g, delay=-3600.0)
        db.schedule_retry(conn, g, ["sec-inj-001"], 960.0, MAX)
        assert 940 < _wait_seconds(conn, g) < 980

    def test_will_not_book_a_pass_on_a_cancelled_run(self, conn, account):
        # Cancel ends the story. Booking here would fire the attack tail at an organizer's field
        # minutes after they told us to stop.
        run = _run(conn, account, status="cancelled")
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        assert _book(conn, g) is False

    def test_will_not_book_a_pass_for_a_grade_no_entry_points_at(self, conn, account):
        # A regrade repoints the entry at a new grade. The superseded one is on no board, so its
        # recovered tail would be spent on a report nobody reads.
        run = _run(conn, account)
        g = _grade(conn, run=run)
        assert _book(conn, g) is False

    def test_books_a_public_grade_which_belongs_to_no_run(self, conn):
        g = _grade(conn)
        assert _book(conn, g) is True

    def test_books_while_a_run_is_paused_because_booking_sends_no_traffic(self, conn, account):
        # Booking is bookkeeping; the claim is what probes. A pause has to HOLD the pass (it is
        # claimed after the resume, see below), not silently discard the tail.
        run = _run(conn, account, paused=True)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        assert _book(conn, g) is True


class TestClaimingAPass:
    def test_takes_a_pass_that_is_due_and_reports_what_to_re_run(self, conn):
        g = _grade(conn, origin="https://app.example.com", mode="active")
        _result(conn, g, blocked=["sec-inj-001", "sec-up-002"], mode="active")
        _book(conn, g, ["sec-inj-001", "sec-up-002"])
        r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        assert r is not None
        assert r.grade_id == g
        assert r.origin == "https://app.example.com"
        assert r.mode == "active"
        # The tail comes from the stored result, not from whatever was passed at booking time: the
        # result is the record of what is still missing.
        assert sorted(r.blocked) == ["sec-inj-001", "sec-up-002"]

    def test_returns_nothing_when_no_pass_is_booked(self, conn):
        g = _grade(conn)
        _result(conn, g, blocked=["sec-inj-001"])
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_leaves_a_pass_whose_cooldown_has_not_elapsed(self, conn):
        # The cooldown IS the respect for the challenge: coming early re-warms a block that was
        # about to clear.
        g = _grade(conn)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g, delay=600.0)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_counts_the_pass_on_the_claim_rather_than_on_success(self, conn):
        # A pass that crashes still counts. Counting on success would let a grade that reliably
        # kills its child come back for ever.
        g = _grade(conn)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        assert r.passes == 1
        assert _row(conn, g)["retry_passes"] == 1

    def test_the_claim_hides_the_pass_for_the_lock_not_for_the_next_cooldown(self, conn):
        # The two clocks. The claim pushes the due time out by the LOCK, long enough to outlive the
        # slowest pass; the 12 then 16 minute cadence is booked explicitly once the pass's outcome
        # is known, so it never depends on how long the pass in between actually ran.
        g = _grade(conn)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        wait = _wait_seconds(conn, g)
        assert abs(wait - config.RETRY_CLAIM_LOCK_SECONDS) < 30
        assert wait > config.RETRY_BLOCKED_NEXT_DELAY_SECONDS

    def test_a_pass_still_running_is_not_handed_out_again(self, conn, second):
        # The lock's whole purpose: while one worker's child is probing the app, a second worker
        # polling the queue must not aim a second pass at the same origin.
        g = _grade(conn)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is not None
        assert db.claim_retry(second, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_two_workers_never_take_the_same_pass(self, conn, second):
        # FOR UPDATE SKIP LOCKED only means anything across sessions, hence the second connection.
        a = _grade(conn, origin="https://a.example.com")
        b = _grade(conn, origin="https://b.example.com")
        for g in (a, b):
            _result(conn, g, blocked=["sec-inj-001"])
            _book(conn, g)
        first = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        other = db.claim_retry(second, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        assert {first.grade_id, other.grade_id} == {a, b}
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_takes_the_most_overdue_pass_first(self, conn):
        old = _grade(conn, origin="https://old.example.com")
        new = _grade(conn, origin="https://new.example.com")
        for g in (old, new):
            _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, old, delay=-3600.0)
        _book(conn, new, delay=-60.0)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES).grade_id == old

    def test_will_not_claim_a_pass_for_a_grade_with_nothing_still_blocked(self, conn):
        # A tail that already came back needs no traffic. This is the guard that stops a stale
        # retry_due_at from re-probing a complete grade.
        g = _grade(conn)
        _result(conn, g, blocked=[])
        _book(conn, g)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_will_not_claim_a_pass_for_a_grade_that_stored_no_result(self, conn):
        # Nothing to fold into: a pass here would produce a narrowed subset record standing alone,
        # which is exactly the "RECALL ONLY, never a standalone score" rule from the grader's
        # scripts/retry_blocked.py.
        g = _grade(conn)
        _book(conn, g)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    @pytest.mark.parametrize("status", ["queued", "running", "failed", "cancelled"])
    def test_only_a_finished_grade_gets_a_recovery_pass(self, conn, status):
        # A grade still in flight will write its own result and book its own tail; one that failed
        # or was cancelled has no measurement to complete.
        g = _grade(conn, status=status)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_clearing_the_booking_stops_the_asking(self, conn):
        g = _grade(conn)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        db.clear_retry(conn, g)
        assert _row(conn, g)["retry_due_at"] is None
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_the_claim_enforces_the_ceiling_itself(self, conn):
        # The claim is the only DURABLE enforcement point, which is why the ceiling lives here as
        # well as in schedule_retry. A worker killed between the claim and the supervisor's post-pass
        # branch (SIGKILL, a power cut, a DB error inside save_result) leaves the passes spent and
        # retry_due_at holding the claim lock, so without this clause the next expiry would hand the
        # same grade out again, and again, for ever.
        g = _grade(conn, passes=MAX)
        _result(conn, g, blocked=["sec-inj-001"])
        conn.execute("UPDATE grades SET retry_due_at = now() - interval '1 minute' WHERE id = %s", (g,))

        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_a_grade_one_pass_below_the_ceiling_is_still_claimed(self, conn):
        # The bound is not off by one: the last permitted pass must still run.
        g = _grade(conn, passes=MAX - 1)
        _result(conn, g, blocked=["sec-inj-001"])
        conn.execute("UPDATE grades SET retry_due_at = now() - interval '1 minute' WHERE id = %s", (g,))

        claimed = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)

        assert claimed is not None
        assert claimed.passes == MAX


class TestPauseAndCancel:
    def test_will_not_claim_a_pass_while_its_run_is_paused(self, conn, account):
        # Pause holds the pass exactly as it holds the queue. An organizer who hits pause has
        # stopped our traffic at their field, and an attack-tail re-check is traffic.
        run = _run(conn, account, paused=True)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_a_paused_run_holds_its_pass_rather_than_losing_it(self, conn, account):
        run = _run(conn, account, paused=True)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        conn.execute("UPDATE event_runs SET paused = false WHERE id = %s", (run,))
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES).grade_id == g

    def test_a_pause_does_not_spend_a_pass(self, conn, account):
        # The counter must not tick while the run is held, or a long pause would silently burn the
        # field's recovery budget.
        run = _run(conn, account, paused=True)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        assert _row(conn, g)["retry_passes"] == 0

    def test_will_not_claim_a_pass_once_the_run_is_cancelled(self, conn, account):
        run = _run(conn, account)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        conn.execute("UPDATE event_runs SET status = 'cancelled' WHERE id = %s", (run,))
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_cancelling_a_run_drops_the_passes_it_had_booked(self, conn, account):
        # Not just hidden: erased. Without this, cancel would leave attack-tail re-checks booked
        # against a field the organizer has closed, for up to the whole ceiling afterwards.
        run = _run(conn, account)
        g = _grade(conn, run=run)
        _entry(conn, run, g)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        db.cancel_run(conn, run)
        assert _row(conn, g)["retry_due_at"] is None
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None

    def test_a_cancel_does_not_reach_another_run_s_passes(self, conn, account):
        mine = _run(conn, account, slug="mine")
        other = _run(conn, account, slug="other")
        g = _grade(conn, run=other)
        _entry(conn, other, g)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        db.cancel_run(conn, mine)
        assert _row(conn, g)["retry_due_at"] is not None

    def test_a_cancel_does_not_reach_a_public_grade_s_pass(self, conn, account):
        run = _run(conn, account)
        g = _grade(conn, origin="https://public.example.com")
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        db.cancel_run(conn, run)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES).grade_id == g

    def test_will_not_claim_a_pass_for_a_grade_the_field_no_longer_points_at(self, conn, account):
        # A regrade unlinks the superseded grade. Its tail is recovered into a report no board reads.
        run = _run(conn, account)
        stale = _grade(conn, run=run)
        fresh = _grade(conn, origin="https://a.example.com", run=run)
        _entry(conn, run, fresh)
        _result(conn, stale, blocked=["sec-inj-001"])
        _book(conn, stale)
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None


class TestTheCadenceAcrossPasses:
    """The ceiling as the supervisor applies it: claim, then either stop or book the escalated wait.
    Reproduced here at the db layer, since that is where the bound is durable."""

    def test_the_whole_recovery_is_bounded_by_the_ceiling(self, conn):
        g = _grade(conn)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        passes = 0
        # Each turn of this loop is one pass that ran and re-tripped the block, which is the worst
        # honest case: the app keeps challenging and we keep coming back at the escalated wait.
        while True:
            r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
            if r is None:
                break
            passes += 1
            assert passes <= MAX, "recovery must not exceed its ceiling"
            if r.passes >= MAX:
                db.clear_retry(conn, g)
            else:
                _book(conn, g)
        assert passes == MAX
        assert _row(conn, g)["retry_due_at"] is None

    def test_a_pass_that_crashes_does_not_rebook_itself_for_ever(self, conn):
        # The crash path books nothing new of its own; it re-books through the same guarded
        # statement, so the spent counter stops it at the ceiling like any other pass.
        g = _grade(conn)
        _result(conn, g, blocked=["sec-inj-001"])
        _book(conn, g)
        booked = 0
        for _ in range(MAX + 5):
            r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
            if r is None:
                break
            # The supervisor's crash branch: the pass produced no verdict, so it re-books at the
            # escalated cooldown unless the passes are spent.
            if r.passes >= MAX:
                db.clear_retry(conn, g)
            elif _book(conn, g, delay=-1.0):
                booked += 1
        assert booked == MAX - 1
        assert db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES) is None


class TestMergingAPassBack:
    """Folding a pass's outcomes onto the stored grade. Only the probes that were actually re-run may
    be replaced: the pass ran a narrowed catalog and knows nothing about the rest of the battery."""

    def _stored(self, *, blocked, mode="passive", initial=None):
        return {
            "mode": mode,
            "catalog_version": "sloptic-test",
            "slop_score": 10.0,
            "axis_slop": {"security": 10.0},
            "coverage": {"probes_total": 2},
            "findings": [_finding("sec-hdr-001")],
            "outcomes": [
                _outcome("sec-hdr-001", outcome="slop_detected", penalty=10),
                _outcome("qa-a11y-001", bundle="qa", category="a11y"),
            ],
            "blocked_probes": list(blocked),
            "incomplete_axes": ["security"],
            "bot_challenge": True,
            "challenge_stage": "limited",
            "retry_blocked_initial": initial,
            "ranking": {"percentile": 12.0, "band": "stale"},
        }

    def test_a_recovered_tail_folds_in_and_the_score_is_recomputed(self, no_curve):
        stored = self._stored(blocked=["sec-inj-001", "sec-inj-002"])
        retry = {
            "outcomes": [_outcome("sec-inj-001", outcome="slop_detected", penalty=40,
                                  category="injection"),
                         _outcome("sec-inj-002", category="injection")],
            "findings": [_finding("sec-inj-001", penalty=40, category="injection")],
            "blocked_probes": [],
        }
        merged = grader.merge_retry(stored, retry, ["sec-inj-001", "sec-inj-002"],
                                    overlay_ids={"sec-inj-001", "sec-inj-002"})
        assert merged["blocked_probes"] == []
        assert merged["incomplete_axes"] == []
        # Recomputed with the grader's own aggregate, never adjusted locally: slop is damped across
        # variant groups and categories, so a recovered finding does not simply add its penalty.
        assert merged["slop_score"] > stored["slop_score"]
        assert {f["probe_id"] for f in merged["findings"]} == {"sec-hdr-001", "sec-inj-001"}

    def test_a_recovered_tail_clears_the_challenge_stamp(self, no_curve):
        # A tail that came back completes the battery. Leaving "limited" stamped would keep a now
        # complete grade out of the ranking for ever, since benchmark.rank refuses a challenge-cut
        # record.
        stored = self._stored(blocked=["sec-inj-001"])
        retry = {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
                 "blocked_probes": [], "bot_challenge": False, "challenge_stage": ""}
        merged = grader.merge_retry(stored, retry, ["sec-inj-001"], overlay_ids={"sec-inj-001"})
        assert merged["bot_challenge"] is False
        assert merged["challenge_stage"] == ""

    def test_a_pass_that_was_challenged_again_keeps_the_tail_honestly_blocked(self, no_curve):
        # Never a false clean. Whatever is still blocked when the passes run out is UNTESTED, and it
        # has to keep saying so.
        stored = self._stored(blocked=["sec-inj-001", "sec-inj-002"])
        retry = {"outcomes": [], "findings": [],
                 "blocked_probes": ["sec-inj-001", "sec-inj-002"],
                 "bot_challenge": True, "challenge_stage": "entry"}
        merged = grader.merge_retry(stored, retry, ["sec-inj-001", "sec-inj-002"],
                                    overlay_ids={"sec-inj-001", "sec-inj-002"})
        assert merged["blocked_probes"] == ["sec-inj-001", "sec-inj-002"]
        assert merged["slop_score"] == stored["slop_score"]
        assert merged["bot_challenge"] is True

    def test_a_partly_recovered_tail_keeps_only_what_is_still_missing(self, no_curve):
        stored = self._stored(blocked=["sec-inj-001", "sec-inj-002"])
        retry = {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
                 "blocked_probes": ["sec-inj-002"], "bot_challenge": True,
                 "challenge_stage": "limited"}
        merged = grader.merge_retry(stored, retry, ["sec-inj-001", "sec-inj-002"],
                                    overlay_ids={"sec-inj-001", "sec-inj-002"})
        assert merged["blocked_probes"] == ["sec-inj-002"]
        assert {o["probe_id"] for o in merged["outcomes"]} == {
            "sec-hdr-001", "qa-a11y-001", "sec-inj-001"}

    def test_the_benign_pad_is_camouflage_and_never_overwrites_the_real_grade(self, no_curve):
        # An active pass leads with the benign battery so it does not read as attack-from-probe-#1.
        # Those probes were already measured in the session this record describes, so their fresh
        # copies must not replace anything: the pad is cover traffic plus a live check that the
        # block cleared.
        stored = self._stored(blocked=["sec-inj-001"], mode="active")
        retry = {
            "outcomes": [_outcome("sec-hdr-001", category="headers"),
                         _outcome("sec-inj-001", category="injection")],
            "findings": [],
            "blocked_probes": [],
        }
        merged = grader.merge_retry(stored, retry, ["sec-inj-001"], overlay_ids={"sec-inj-001"})
        hdr = [o for o in merged["outcomes"] if o["probe_id"] == "sec-hdr-001"]
        assert len(hdr) == 1
        assert hdr[0]["outcome"] == "slop_detected", "the pad must not overwrite the stored verdict"
        assert [f["probe_id"] for f in merged["findings"]] == ["sec-hdr-001"]

    def test_a_pad_probe_the_pass_tripped_on_does_not_become_a_new_block(self, no_curve):
        # The pad was graded in the main run. A challenge met while re-running it says nothing about
        # the tail we came back for, and admitting it would grow the blocked set every pass.
        stored = self._stored(blocked=["sec-inj-001"], mode="active")
        retry = {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
                 "blocked_probes": ["sec-inj-001", "sec-hdr-001"]}
        merged = grader.merge_retry(stored, retry, ["sec-inj-001"], overlay_ids={"sec-inj-001"})
        assert merged["blocked_probes"] == ["sec-inj-001"]

    def test_a_passive_pass_re_runs_the_battery_without_double_counting_it(self, no_curve):
        # The passive lane re-runs the WHOLE 44, so every probe it produces overlays the stored copy.
        # Keying only on the asked-for ids would keep the stored copy AND add the fresh one, counting
        # each into the score twice.
        stored = self._stored(blocked=["sec-inj-001"])
        retry = {
            "outcomes": [_outcome("sec-hdr-001", outcome="slop_detected", penalty=10),
                         _outcome("qa-a11y-001", bundle="qa", category="a11y"),
                         _outcome("sec-inj-001", category="injection")],
            "findings": [_finding("sec-hdr-001")],
            "blocked_probes": [],
        }
        merged = grader.merge_retry(stored, retry, ["sec-inj-001"], overlay_ids=None)
        ids = [o["probe_id"] for o in merged["outcomes"]]
        assert sorted(ids) == ["qa-a11y-001", "sec-hdr-001", "sec-inj-001"]
        assert merged["slop_score"] == stored["slop_score"]

    def test_coverage_is_recomputed_from_the_merged_battery(self, no_curve):
        # Not cosmetic: the passive rank guard compares coverage.probes_total against the curve's
        # battery, so a merged record still carrying the pre-onset slice would be refused a
        # percentile it has now earned.
        stored = self._stored(blocked=["sec-inj-001"])
        retry = {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
                 "blocked_probes": []}
        merged = grader.merge_retry(stored, retry, ["sec-inj-001"], overlay_ids={"sec-inj-001"})
        assert merged["coverage"]["probes_total"] == 3

    def test_a_stale_pre_recovery_ranking_never_survives_the_merge(self, monkeypatch):
        # The recovered tail is the injection and upload families, exactly the probes that move a
        # percentile or trip a catastrophe gate, so a placement computed before them no longer
        # matches the findings it claims to describe.
        monkeypatch.setattr(grader.ranking, "rank_passive",
                            lambda *a, **k: {"percentile": 71.5, "band": "fresh"})
        monkeypatch.setattr(grader.ranking, "load_curve", lambda *a, **k: {"version": "passive-2026.1"})
        stored = self._stored(blocked=["sec-inj-001"])
        retry = {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
                 "blocked_probes": []}
        merged = grader.merge_retry(stored, retry, ["sec-inj-001"], overlay_ids={"sec-inj-001"})
        assert merged["ranking"]["percentile"] == 71.5
        assert merged["ranking"]["curve_version"] == "passive-2026.1"

    def test_a_ranking_that_can_no_longer_be_computed_becomes_an_honest_absence(self, no_curve):
        stored = self._stored(blocked=["sec-inj-001"])
        retry = {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
                 "blocked_probes": []}
        merged = grader.merge_retry(stored, retry, ["sec-inj-001"], overlay_ids={"sec-inj-001"})
        assert merged["ranking"] is None

    def test_an_outcome_shape_we_cannot_read_stops_the_merge_rather_than_guessing(self, no_curve):
        # Silently dropping a record we cannot rehydrate would quietly lower the score, which is the
        # worst possible direction for a deduction-only grade.
        stored = self._stored(blocked=["sec-inj-001"])
        retry = {"outcomes": [{"probe_id": "sec-inj-001", "who_knows": True}], "findings": [],
                 "blocked_probes": []}
        with pytest.raises(ValueError):
            grader.merge_retry(stored, retry, ["sec-inj-001"], overlay_ids={"sec-inj-001"})

    def test_the_first_pass_records_how_many_were_blocked_when_recovery_began(self, no_curve):
        # blocked_probes only ever holds what is STILL blocked, so the original count is gone the
        # moment a pass lands. Without this the report cannot say "recovered P of M" (0021).
        stored = self._stored(blocked=["sec-inj-001", "sec-inj-002"], initial=None)
        retry = {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
                 "blocked_probes": ["sec-inj-002"]}
        merged = grader.merge_retry(stored, retry, ["sec-inj-001", "sec-inj-002"],
                                    overlay_ids={"sec-inj-001", "sec-inj-002"})
        assert merged["retry_blocked_initial"] == 2

    def test_a_later_pass_keeps_the_count_recovery_began_with(self, no_curve):
        # The second pass sees a shrunken blocked set. Recomputing from it would report "recovered 1
        # of 1" for a grade that started with six blocked probes.
        stored = self._stored(blocked=["sec-inj-002"], initial=6)
        retry = {"outcomes": [_outcome("sec-inj-002", category="injection")], "findings": [],
                 "blocked_probes": []}
        merged = grader.merge_retry(stored, retry, ["sec-inj-002"], overlay_ids={"sec-inj-002"})
        assert merged["retry_blocked_initial"] == 6


class TestWhatTheBoardShows:
    """The columns the merge leaves behind are the input to recoveryMarks in web/lib/grades.ts, so a
    recovery that recovered nothing, some, or all of the tail has to come out as N, P and F, and a
    pass still pending as B."""

    def _record(self, blocked, *, initial=None):
        return {
            "mode": "passive", "catalog_version": "sloptic-test", "slop_score": 10.0,
            "axis_slop": {"security": 10.0}, "coverage": {"probes_total": 3},
            "findings": [], "outcomes": [_outcome("sec-hdr-001")],
            "blocked_probes": list(blocked), "incomplete_axes": ["security"],
            "bot_challenge": True, "challenge_stage": "limited",
            "retry_blocked_initial": initial,
        }

    def _board(self, conn, grade):
        row = conn.execute(
            """SELECT g.retry_due_at, g.retry_passes,
                      r.retry_blocked_initial, array_length(r.blocked_probes, 1) AS blocked
                 FROM grades g JOIN results r ON r.grade_id = g.id WHERE g.id = %s""",
            (grade,),
        ).fetchone()
        return _marks(retry_due_at=row["retry_due_at"], retry_passes=row["retry_passes"],
                      initial=row["retry_blocked_initial"], blocked=row["blocked"] or 0)

    def _challenged_grade(self, conn, blocked):
        g = _grade(conn)
        db.save_result(conn, g, self._record(blocked))
        db.schedule_retry(conn, g, blocked, -60.0, MAX)
        return g

    def test_a_booked_pass_reads_as_pending_until_it_runs(self, conn, no_curve):
        g = self._challenged_grade(conn, ["sec-inj-001", "sec-inj-002"])
        marks = self._board(conn, g)
        assert marks["retry"] is True
        # Nothing else may show yet: a pending pass has not recovered or failed to recover anything.
        assert not (marks["none"] or marks["partial"] or marks["full"])

    def test_a_pass_that_recovered_the_whole_tail_reads_as_recovered(self, conn, no_curve):
        g = self._challenged_grade(conn, ["sec-inj-001", "sec-inj-002"])
        r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        merged = grader.merge_retry(
            db.load_result(conn, g),
            {"outcomes": [_outcome("sec-inj-001", category="injection"),
                          _outcome("sec-inj-002", category="injection")],
             "findings": [], "blocked_probes": []},
            r.blocked, overlay_ids=set(r.blocked))
        db.save_result(conn, g, merged)
        db.clear_retry(conn, g)
        assert self._board(conn, g) == {"retry": False, "none": False, "partial": False, "full": True}

    def test_a_pass_that_recovered_part_of_the_tail_reads_as_partial(self, conn, no_curve):
        g = self._challenged_grade(conn, ["sec-inj-001", "sec-inj-002"])
        r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        merged = grader.merge_retry(
            db.load_result(conn, g),
            {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
             "blocked_probes": ["sec-inj-002"]},
            r.blocked, overlay_ids=set(r.blocked))
        db.save_result(conn, g, merged)
        db.clear_retry(conn, g)
        marks = self._board(conn, g)
        assert marks["partial"] is True
        assert marks["full"] is False and marks["none"] is False

    def test_a_pass_that_recovered_nothing_says_so_rather_than_going_quiet(self, conn, no_curve):
        # The N mark needs retry_blocked_initial to survive: with it NULL the board reads initial 0,
        # draws no mark at all, and a grade whose tail was never tested looks like an ordinary one.
        g = self._challenged_grade(conn, ["sec-inj-001", "sec-inj-002"])
        r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        merged = grader.merge_retry(
            db.load_result(conn, g),
            {"outcomes": [], "findings": [], "blocked_probes": list(r.blocked),
             "bot_challenge": True, "challenge_stage": "entry"},
            r.blocked, overlay_ids=set(r.blocked))
        db.save_result(conn, g, merged)
        db.clear_retry(conn, g)
        assert self._board(conn, g) == {"retry": False, "none": True, "partial": False, "full": False}

    def test_a_merged_grade_stays_done_and_keeps_its_passes(self, conn, no_curve):
        # save_result is reused for the merge, so the grade must come back done rather than being
        # re-opened, and the pass counter must not be reset by the write.
        g = self._challenged_grade(conn, ["sec-inj-001"])
        r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        merged = grader.merge_retry(
            db.load_result(conn, g),
            {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
             "blocked_probes": []},
            r.blocked, overlay_ids=set(r.blocked))
        db.save_result(conn, g, merged)
        row = conn.execute("SELECT status, retry_passes FROM grades WHERE id = %s", (g,)).fetchone()
        assert row["status"] == "done"
        assert row["retry_passes"] == 1
        stored = db.load_result(conn, g)
        assert stored["blocked_probes"] == []
        assert stored["retry_blocked_initial"] == 1
        assert stored["challenge_stage"] is None or stored["challenge_stage"] == ""

    def test_the_merge_replaces_the_stored_result_rather_than_adding_one(self, conn, no_curve):
        g = self._challenged_grade(conn, ["sec-inj-001"])
        r = db.claim_retry(conn, config.RETRY_CLAIM_LOCK_SECONDS, config.RETRY_BLOCKED_MAX_PASSES)
        merged = grader.merge_retry(
            db.load_result(conn, g),
            {"outcomes": [_outcome("sec-inj-001", category="injection")], "findings": [],
             "blocked_probes": []},
            r.blocked, overlay_ids=set(r.blocked))
        db.save_result(conn, g, merged)
        n = conn.execute("SELECT count(*) AS n FROM results WHERE grade_id = %s", (g,)).fetchone()["n"]
        assert n == 1


def test_the_recovery_columns_start_empty_on_an_ordinary_grade(conn):
    # The ordinary case, and the one the defaults have to get right: no challenge means no booking,
    # no spent pass, and a NULL initial count (0021), which is what makes the board draw no mark.
    g = _grade(conn)
    _result(conn, g)
    row = conn.execute(
        """SELECT g.retry_due_at, g.retry_passes, r.blocked_probes, r.retry_blocked_initial,
                  r.bot_challenge, r.challenge_stage, r.challenge_onset_index
             FROM grades g JOIN results r ON r.grade_id = g.id WHERE g.id = %s""",
        (g,),
    ).fetchone()
    assert row["retry_due_at"] is None
    assert row["retry_passes"] == 0
    assert row["blocked_probes"] == []
    assert row["retry_blocked_initial"] is None
    assert row["bot_challenge"] is False
    assert row["challenge_stage"] is None
    assert row["challenge_onset_index"] is None


class TestTheRetryLaneIsAuthorizedLikeTheGradeItContinues:
    """A pass re-sends the blocked tail, which on an active grade is the injection and upload
    families, 12 to 28 minutes after the grade finished. Authorization can be gone by then, and
    booking the pass earlier is not consent to send it later. These pin the gate in __main__, not
    claim_retry: the claim is bookkeeping, the gate is next to the decision to send."""

    def _active(self, conn, account, origin="https://owned.example.com"):
        g = _grade(conn, origin=origin, mode="active", account=account)
        _result(conn, g, blocked=["sqli-001"], mode="active")
        db.schedule_retry(conn, g, ["sqli-001"], 0, config.RETRY_BLOCKED_MAX_PASSES)
        return g

    def _grant(self, conn, account, origin):
        conn.execute(
            """INSERT INTO grants (account_id, kind, scope, expires_at)
               VALUES (%s, 'app_origin', %s, now() + interval '90 days')""",
            (account, origin),
        )

    def test_a_pass_is_refused_once_the_grant_is_revoked(self, conn, account, monkeypatch):
        from sloptic_web_worker import __main__ as main
        origin = "https://owned.example.com"
        self._active(conn, account, origin)
        conn.execute(
            """INSERT INTO grants (account_id, kind, scope, expires_at, revoked_at)
               VALUES (%s, 'app_origin', %s, now() + interval '90 days', now())""",
            (account, origin),
        )
        monkeypatch.setattr(main.egress, "guard_target", lambda *a, **k: None)
        sent: list = []
        monkeypatch.setattr(main, "_retry_pass", lambda *a, **k: sent.append(a))

        main.process_retries(conn)

        assert sent == [], "a revoked grant must not send the blocked attack tail"

    def test_a_refused_pass_is_not_handed_out_again(self, conn, account, monkeypatch):
        """Otherwise the lane re-asks every lock interval and the denial is only a delay."""
        from sloptic_web_worker import __main__ as main
        g = self._active(conn, account)
        monkeypatch.setattr(main.egress, "guard_target", lambda *a, **k: None)
        monkeypatch.setattr(main, "_retry_pass", lambda *a, **k: pytest.fail("sent"))

        main.process_retries(conn)

        due = conn.execute("SELECT retry_due_at FROM grades WHERE id = %s", (g,)).fetchone()
        assert due["retry_due_at"] is None

    def test_a_pass_is_refused_when_no_grant_was_ever_written(self, conn, account, monkeypatch):
        from sloptic_web_worker import __main__ as main
        self._active(conn, account)
        monkeypatch.setattr(main.egress, "guard_target", lambda *a, **k: None)
        monkeypatch.setattr(main, "_retry_pass", lambda *a, **k: pytest.fail("sent"))

        assert main.process_retries(conn) == 1

    def test_a_pass_is_refused_when_the_egress_sandbox_is_not_ready(self, conn, account, monkeypatch):
        """Fail closed on the same gate grade_child fails closed on."""
        from sloptic_web_worker import __main__ as main
        origin = "https://owned.example.com"
        self._active(conn, account, origin)
        self._grant(conn, account, origin)

        def _refuse(*a, **k):
            raise main.egress.EgressNotReady("sandbox off")
        monkeypatch.setattr(main.egress, "guard_target", _refuse)
        monkeypatch.setattr(main, "_retry_pass", lambda *a, **k: pytest.fail("sent"))

        main.process_retries(conn)

    def test_a_passive_pass_needs_no_grant(self, conn, monkeypatch):
        """The passive battery is what every visitor may do, so the gate does not apply to it. This
        is the test that keeps the fix from being "stop retrying"."""
        from sloptic_web_worker import __main__ as main
        g = _grade(conn, mode="passive")
        _result(conn, g, blocked=["hdr-001"], mode="passive")
        db.schedule_retry(conn, g, ["hdr-001"], 0, config.RETRY_BLOCKED_MAX_PASSES)
        sent: list = []
        monkeypatch.setattr(main, "_retry_pass",
                            lambda origin, mode, only: sent.append(origin) or {"slop_score": 0})

        main.process_retries(conn)

        assert sent == ["https://a.example.com"]
