"""The event resolver path: claiming a run, storing its field, failing it, settling it.

Resolving is the step whose output an organizer approves before any traffic is sent, so its writes
carry the consent chain. Three of them are load bearing and have all been wrong at some point:

  * save_field MERGES. The refresh button re-resolves a live run, and a replace would orphan grades
    already produced (0013: an entry's grade_id is the only link between the board and its report).
  * pruning happens ONLY against a listing we know is whole. sloptic.devpost is tri-state, and a
    `blocked` gallery is short by an unknown amount (CLAUDE.md: only 404 and 410 mean absence), so
    deleting what it failed to list would erase teams from the field on a WAF's whim.
  * the run row is only advanced from `resolving`. A cancel landing while the gallery was being read
    must stay cancelled: the organizer has already been told the run stopped.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass

from sloptic_web_worker import db

_SLUGS = itertools.count()


@dataclass
class _E:
    """Shaped like resolve_event.Entry, which is all save_field reads off it."""
    project_url: str
    app_url: str | None = None
    skip_reason: str | None = None


def _run(conn, account, *, status="resolving", slug=None, mode="passive", override=False,
         refresh=False, created="now()", started="NULL", paused=False):
    # Slugs default to unique because 0025 allows one live run per (account, slug) and most of these
    # tests need two runs alive at once.
    slug = slug or f"hack-{next(_SLUGS)}"
    row = conn.execute(
        f"""INSERT INTO event_runs (account_id, slug, mode, status, override, refresh_requested,
                                    paused, created_at, started_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, {created}, {started}) RETURNING id""",
        (account, slug, mode, status, override, refresh, paused),
    ).fetchone()
    return str(row["id"])


def _run_row(conn, run_id):
    return conn.execute("SELECT * FROM event_runs WHERE id = %s", (run_id,)).fetchone()


def _grade(conn, run=None, *, status="done", origin="https://a.example.com", account=None):
    row = conn.execute(
        """INSERT INTO grades (origin, submitted_url, mode, status, event_run_id, account_id)
           VALUES (%s, %s, 'passive', %s, %s, %s) RETURNING id""",
        (origin, origin, status, run, account),
    ).fetchone()
    return str(row["id"])


def _entry(conn, run, project_url, *, app_url=None, skip=None, grade=None):
    conn.execute(
        """INSERT INTO event_entries (run_id, project_url, app_url, skip_reason, grade_id)
           VALUES (%s, %s, %s, %s, %s)""",
        (run, project_url, app_url, skip, grade),
    )


def _field(conn, run_id):
    """project_url -> (app_url, skip_reason, grade_id), which is the whole of what a row means."""
    rows = conn.execute(
        "SELECT project_url, app_url, skip_reason, grade_id FROM event_entries WHERE run_id = %s",
        (run_id,),
    ).fetchall()
    return {
        r["project_url"]: (r["app_url"], r["skip_reason"],
                           str(r["grade_id"]) if r["grade_id"] else None)
        for r in rows
    }


def _p(n: int) -> str:
    return f"https://devpost.com/software/team-{n}"


class TestClaimEventRun:
    def test_takes_the_oldest_run_still_waiting_on_its_field(self, conn, account):
        old = _run(conn, account, created="now() - interval '10 minutes'")
        _run(conn, account)
        assert db.claim_event_run(conn).id == old

    def test_marks_the_run_claimed_so_a_slow_gallery_pull_is_not_taken_twice(self, conn, account):
        # started_at is the only claim marker a resolving run has, and a gallery pull is minutes of
        # HTTP. Without the stamp the same run is resolved twice over, doubling Devpost traffic and
        # racing two merges into one field.
        run = _run(conn, account)
        assert db.claim_event_run(conn).id == run
        assert _run_row(conn, run)["started_at"] is not None
        assert db.claim_event_run(conn) is None

    def test_leaves_a_resolve_already_in_progress_alone(self, conn, account):
        _run(conn, account, started="now()")
        assert db.claim_event_run(conn) is None

    def test_only_a_run_asking_to_be_resolved_is_claimed(self, conn, account):
        for status in ("ready", "grading", "done", "failed", "cancelled"):
            _run(conn, account, status=status)
        assert db.claim_event_run(conn) is None

    def test_carries_the_run_s_own_terms_to_the_worker(self, conn, account):
        # mode decides which battery and therefore which curve, override says nobody proved they run
        # this event, and refresh_requested switches the resolve into re-check mode. All three are
        # decided by the row, never by the worker.
        run = _run(conn, account, slug="my-hack", mode="passive", override=True, refresh=True)
        got = db.claim_event_run(conn)
        assert (got.id, got.slug, got.mode, got.override, got.refresh_requested) == (
            run, "my-hack", "passive", True, True)

    def test_an_ordinary_run_is_not_a_refresh(self, conn, account):
        _run(conn, account)
        assert db.claim_event_run(conn).refresh_requested is False

    def test_two_workers_never_resolve_the_same_run(self, conn, second, account):
        # SKIP LOCKED only means anything across sessions, so this needs the second connection.
        a = _run(conn, account, created="now() - interval '1 minute'")
        b = _run(conn, account)
        first = db.claim_event_run(conn)
        other = db.claim_event_run(second)
        assert {first.id, other.id} == {a, b}
        assert db.claim_event_run(conn) is None

    def test_returns_nothing_when_no_field_is_waiting(self, conn):
        assert db.claim_event_run(conn) is None


class TestSaveFieldMerge:
    def test_a_first_resolve_writes_the_whole_field(self, conn, account):
        run = _run(conn, account)
        db.save_field(conn, run, [
            _E(_p(1), "https://one.example.com"),
            _E(_p(2), None, "no deployment"),
        ], True, "read the gallery")
        assert _field(conn, run) == {
            _p(1): ("https://one.example.com", None, None),
            _p(2): (None, "no deployment", None),
        }

    def test_an_entry_that_already_has_a_grade_keeps_its_row_untouched(self, conn, account):
        # The grade was produced against the URL on this row. Letting a later resolve swap the URL
        # under a finished report makes the board cite an address that was never graded.
        run = _run(conn, account)
        g = _grade(conn, run)
        _entry(conn, run, _p(1), app_url="https://graded.example.com", grade=g)
        db.save_field(conn, run, [_E(_p(1), "https://moved.example.com", "vendor surface")], True, "")
        assert _field(conn, run) == {_p(1): ("https://graded.example.com", None, g)}

    def test_an_ungraded_entry_takes_the_fresh_app_url_and_skip_decision(self, conn, account):
        run = _run(conn, account)
        _entry(conn, run, _p(1), app_url="https://stale.example.com")
        db.save_field(conn, run, [_E(_p(1), None, "vendor surface")], True, "")
        assert _field(conn, run) == {_p(1): (None, "vendor surface", None)}

    def test_an_entry_that_became_gradeable_loses_the_reason_it_was_skipped(self, conn, account):
        # A team that had nothing deployed at the deadline deploys an hour later. The refresh has to
        # clear the reason as well as set the URL, or the row stays excluded from the field for ever.
        run = _run(conn, account)
        _entry(conn, run, _p(1), skip="nothing deployed")
        db.save_field(conn, run, [_E(_p(1), "https://late.example.com", None)], True, "")
        assert _field(conn, run) == {_p(1): ("https://late.example.com", None, None)}

    def test_a_complete_listing_drops_a_team_the_gallery_no_longer_lists(self, conn, account):
        # A withdrawn submission. Safe to act on only because the listing is known whole.
        run = _run(conn, account)
        _entry(conn, run, _p(1), app_url="https://one.example.com")
        _entry(conn, run, _p(2), app_url="https://two.example.com")
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com")], True, "")
        assert set(_field(conn, run)) == {_p(1)}

    def test_a_partial_listing_never_deletes_teams_from_the_field(self, conn, account):
        # sloptic.devpost is tri-state and only 404/410 mean absence: a `blocked` gallery is short by
        # an unknown amount. Pruning against it would erase teams on a WAF's whim, which is the
        # failure 0013's gallery_complete exists to describe rather than to cause.
        run = _run(conn, account)
        _entry(conn, run, _p(1), app_url="https://one.example.com")
        _entry(conn, run, _p(2), app_url="https://two.example.com")
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com")], False, "gallery blocked")
        assert set(_field(conn, run)) == {_p(1), _p(2)}

    def test_pruning_never_orphans_graded_work(self, conn, account):
        # Deleting a graded entry would cut the only link between the board and a report that was
        # already paid for, and 0013 makes grade_id ON DELETE SET NULL, so the grade would survive
        # pointing at nothing.
        run = _run(conn, account)
        g = _grade(conn, run)
        _entry(conn, run, _p(1), app_url="https://graded.example.com", grade=g)
        db.save_field(conn, run, [_E(_p(2), "https://two.example.com")], True, "")
        assert set(_field(conn, run)) == {_p(1), _p(2)}
        assert _field(conn, run)[_p(1)][2] == g

    def test_an_empty_listing_leaves_the_field_standing(self, conn, account):
        # A gallery that suddenly lists nobody is far likelier to be Devpost changing shape than a
        # whole field withdrawing, so the empty case is not treated as a contradiction of the rows.
        run = _run(conn, account)
        _entry(conn, run, _p(1), app_url="https://one.example.com")
        db.save_field(conn, run, [], True, "no entries")
        assert set(_field(conn, run)) == {_p(1)}

    def test_a_re_resolve_adds_the_late_submissions_without_disturbing_the_rest(self, conn, account):
        run = _run(conn, account)
        g = _grade(conn, run)
        _entry(conn, run, _p(1), app_url="https://one.example.com", grade=g)
        _entry(conn, run, _p(2), app_url="https://two.example.com")
        db.save_field(conn, run, [
            _E(_p(1), "https://one.example.com"),
            _E(_p(2), "https://two.example.com"),
            _E(_p(3), "https://three.example.com"),
        ], True, "")
        assert _field(conn, run) == {
            _p(1): ("https://one.example.com", None, g),
            _p(2): ("https://two.example.com", None, None),
            _p(3): ("https://three.example.com", None, None),
        }

    def test_one_run_s_field_is_never_touched_by_another_s_resolve(self, conn, account):
        # The same team appears in every run of the same event, and project_url is only unique per
        # run (0013). A prune that forgot its run_id would strip the neighbouring board.
        mine = _run(conn, account)
        theirs = _run(conn, account)
        _entry(conn, theirs, _p(1), app_url="https://one.example.com")
        db.save_field(conn, mine, [_E(_p(2), "https://two.example.com")], True, "")
        assert set(_field(conn, theirs)) == {_p(1)}


class TestSaveFieldRunRow:
    def test_the_field_lands_ready_for_the_organizer_to_look_at(self, conn, account):
        # Ready, not grading: 0013 is explicit that the organizer sees whose apps would be probed
        # before anything is probed.
        run = _run(conn, account)
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com"), _E(_p(2), None, "skipped")],
                      True, "44 checks")
        row = _run_row(conn, run)
        assert row["status"] == "ready"
        assert row["entries_found"] == 2
        assert row["gallery_complete"] is True
        assert row["detail"] == "44 checks"
        assert row["resolved_at"] is not None

    def test_gallery_complete_travels_as_a_fact_rather_than_a_count(self, conn, account):
        # Two runs, the same two entries, different truth about the listing. A count cannot tell them
        # apart, and only one of them is safe to rank: 40 of 60 ranked without saying so is worse
        # than no board.
        whole = _run(conn, account)
        short = _run(conn, account)
        entries = [_E(_p(1), "https://one.example.com"), _E(_p(2), "https://two.example.com")]
        db.save_field(conn, whole, entries, True, "")
        db.save_field(conn, short, entries, False, "gallery blocked partway")
        assert _run_row(conn, whole)["entries_found"] == _run_row(conn, short)["entries_found"] == 2
        assert _run_row(conn, whole)["gallery_complete"] is True
        assert _run_row(conn, short)["gallery_complete"] is False

    def test_a_cancel_that_lands_mid_resolve_is_not_resurrected(self, conn, account):
        # The organizer has already been told the run stopped. A field arriving after that must not
        # put it back on the board as ready, which is the same guard the refresh route repeats on
        # its own write.
        run = _run(conn, account)
        conn.execute("UPDATE event_runs SET status='cancelled', finished_at=now() WHERE id=%s", (run,))
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com")], True, "read the gallery")
        row = _run_row(conn, run)
        assert row["status"] == "cancelled"
        assert row["resolved_at"] is None
        assert row["entries_found"] is None

    def test_a_run_that_failed_is_not_quietly_made_ready(self, conn, account):
        run = _run(conn, account, status="failed")
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com")], True, "")
        assert _run_row(conn, run)["status"] == "failed"


class TestRefreshCounters:
    def test_a_first_resolve_leaves_the_counters_unset(self, conn, account):
        # 0023: null means this run has never been refreshed. To a first resolve everything is new,
        # so reporting "194 new submissions" on it would be a number about nothing.
        run = _run(conn, account)
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com")], True, "")
        row = _run_row(conn, run)
        assert row["refresh_new_submissions"] is None
        assert row["refresh_modified_submissions"] is None

    def test_a_refresh_records_what_it_measured(self, conn, account):
        run = _run(conn, account, refresh=True)
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com")], True, "", (3, 2))
        row = _run_row(conn, run)
        assert (row["refresh_new_submissions"], row["refresh_modified_submissions"]) == (3, 2)

    def test_a_refresh_that_found_nothing_says_zero_rather_than_nothing(self, conn, account):
        # The event page prints "no changes" for 0/0 and prints nothing at all for null, so a
        # measured zero collapsing to null loses the answer the organizer clicked for.
        run = _run(conn, account, refresh=True)
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com")], True, "", (0, 0))
        row = _run_row(conn, run)
        assert (row["refresh_new_submissions"], row["refresh_modified_submissions"]) == (0, 0)

    def test_the_refresh_flag_is_spent_by_the_resolve_that_honoured_it(self, conn, account):
        # Only the refresh route sets it. Leaving it set would make the next ordinary resolve of the
        # run re-fetch every submission and describe itself as a refresh that nobody asked for.
        run = _run(conn, account, refresh=True)
        db.save_field(conn, run, [_E(_p(1), "https://one.example.com")], True, "", (1, 0))
        assert _run_row(conn, run)["refresh_requested"] is False

    def test_the_prior_field_is_read_from_the_rows_the_organizer_saw(self, conn, account):
        # The counts are measurements, not guesses: they compare the fresh listing against the FIELD,
        # so a cold submission cache cannot call all 194 entries new. Graded and skipped rows are
        # part of that field.
        run = _run(conn, account)
        g = _grade(conn, run)
        _entry(conn, run, _p(1), app_url="https://one.example.com", grade=g)
        _entry(conn, run, _p(2), skip="nothing deployed")
        assert db.field_prior(conn, run) == {
            _p(1): ("https://one.example.com", None),
            _p(2): (None, "nothing deployed"),
        }

    def test_the_prior_field_carries_both_halves_of_a_row_so_either_change_counts(self, conn, account):
        # "Modified" means the grade target or the eligibility moved. Comparing app_url alone would
        # miss a team that went from skipped to gradeable, which is the change that matters most.
        run = _run(conn, account)
        _entry(conn, run, _p(1), app_url="https://one.example.com")
        prior = db.field_prior(conn, run)
        assert prior[_p(1)] != ("https://moved.example.com", None)
        assert prior[_p(1)] != ("https://one.example.com", "vendor surface")
        assert prior[_p(1)] == ("https://one.example.com", None)

    def test_the_prior_field_is_scoped_to_its_own_run(self, conn, account):
        mine = _run(conn, account)
        theirs = _run(conn, account)
        _entry(conn, theirs, _p(1), app_url="https://one.example.com")
        assert db.field_prior(conn, mine) == {}


class TestFailRun:
    def test_a_resolve_that_could_not_finish_says_so_and_stops_the_clock(self, conn, account):
        run = _run(conn, account, started="now()")
        db.fail_run(conn, run, "worker error: Blocked: gallery")
        row = _run_row(conn, run)
        assert row["status"] == "failed"
        assert row["detail"] == "worker error: Blocked: gallery"
        assert row["finished_at"] is not None

    def test_a_failure_leaves_the_run_out_of_the_resolver_s_way(self, conn, account):
        # The honest exit from a claimed run: only the resolver re-arms started_at, so a run left in
        # `resolving` after a raise would be wedged there for ever, claimed and never worked on.
        run = _run(conn, account, started="now()")
        db.fail_run(conn, run, "worker error")
        assert db.claim_event_run(conn) is None

    def test_a_failed_refresh_keeps_the_field_the_organizer_already_had(self, conn, account):
        # A refresh puts a live run back into resolving. If its gallery pull then dies, the board it
        # was showing (grades and all) has to survive: the failure is about the new listing.
        run = _run(conn, account, status="resolving", refresh=True, started="now()")
        g = _grade(conn, run)
        _entry(conn, run, _p(1), app_url="https://one.example.com", grade=g)
        db.fail_run(conn, run, "worker error: Blocked")
        assert _field(conn, run) == {_p(1): ("https://one.example.com", None, g)}

    def test_a_long_traceback_is_truncated_rather_than_stored_whole(self, conn, account):
        run = _run(conn, account)
        db.fail_run(conn, run, "x" * 5000)
        assert len(_run_row(conn, run)["detail"]) == 2000


class TestSettleFinishedRuns:
    def test_a_run_settles_once_every_gradeable_entry_is_graded_and_none_is_in_flight(self, conn, account):
        run = _run(conn, account, status="grading")
        _entry(conn, run, _p(1), app_url="https://one.example.com", grade=_grade(conn, run))
        _entry(conn, run, _p(2), skip="nothing deployed")
        assert db.settle_finished_runs(conn) == 1
        row = _run_row(conn, run)
        assert row["status"] == "done"
        assert row["finished_at"] is not None

    def test_a_grade_still_queued_holds_the_run_open(self, conn, account):
        run = _run(conn, account, status="grading")
        _entry(conn, run, _p(1), app_url="https://one.example.com",
               grade=_grade(conn, run, status="queued"))
        assert db.settle_finished_runs(conn) == 0
        assert _run_row(conn, run)["status"] == "grading"

    def test_a_grade_still_running_holds_the_run_open(self, conn, account):
        run = _run(conn, account, status="grading")
        _entry(conn, run, _p(1), app_url="https://one.example.com",
               grade=_grade(conn, run, status="running"))
        assert db.settle_finished_runs(conn) == 0

    def test_a_gradeable_entry_nobody_has_enqueued_yet_holds_the_run_open(self, conn, account):
        # An organizer grading app by app as each team finishes demoing has long gaps with nothing in
        # flight. "Nothing running" alone would settle the run after the first entry and report a
        # board of one.
        run = _run(conn, account, status="grading")
        _entry(conn, run, _p(1), app_url="https://one.example.com", grade=_grade(conn, run))
        _entry(conn, run, _p(2), app_url="https://two.example.com")
        assert db.settle_finished_runs(conn) == 0

    def test_an_entry_that_must_not_be_probed_does_not_hold_a_run_open(self, conn, account):
        # A vendor surface or an undeployed project is never going to get a grade_id, so counting it
        # as outstanding would leave every real board reading as still grading for ever.
        run = _run(conn, account, status="grading")
        _entry(conn, run, _p(1), skip="vendor surface")
        _entry(conn, run, _p(2), skip="nothing deployed")
        assert db.settle_finished_runs(conn) == 1

    def test_a_grade_that_failed_is_still_an_answer_and_the_run_settles(self, conn, account):
        # "Did not respond" is a result about the app, not an unfinished board. The entry keeps its
        # grade_id, so the row has been attempted and the run can end.
        run = _run(conn, account, status="grading")
        _entry(conn, run, _p(1), app_url="https://one.example.com",
               grade=_grade(conn, run, status="failed"))
        assert db.settle_finished_runs(conn) == 1

    def test_a_run_still_only_ready_settles_when_there_is_nothing_left_to_do(self, conn, account):
        run = _run(conn, account, status="ready")
        _entry(conn, run, _p(1), app_url="https://one.example.com", grade=_grade(conn, run))
        assert db.settle_finished_runs(conn) == 1

    def test_a_cancelled_run_is_never_rewritten_as_done(self, conn, account):
        # Cancel is a distinct ending on purpose: "done" would claim a board the organizer stopped
        # was carried to completion.
        run = _run(conn, account, status="cancelled")
        _entry(conn, run, _p(1), skip="nothing deployed")
        assert db.settle_finished_runs(conn) == 0
        assert _run_row(conn, run)["status"] == "cancelled"

    def test_a_run_that_failed_is_never_rewritten_as_done(self, conn, account):
        run = _run(conn, account, status="failed")
        _entry(conn, run, _p(1), skip="nothing deployed")
        assert db.settle_finished_runs(conn) == 0

    def test_a_run_still_resolving_is_not_settled_before_it_has_a_field(self, conn, account):
        # Its entries table is empty precisely because the gallery has not landed yet, and every
        # condition below would otherwise be vacuously true.
        run = _run(conn, account, status="resolving", started="now()")
        assert db.settle_finished_runs(conn) == 0
        assert _run_row(conn, run)["status"] == "resolving"

    def test_another_run_s_unfinished_work_does_not_hold_this_one_open(self, conn, account):
        mine = _run(conn, account, status="grading")
        _entry(conn, mine, _p(1), app_url="https://one.example.com", grade=_grade(conn, mine))
        theirs = _run(conn, account, status="grading")
        _entry(conn, theirs, _p(2), app_url="https://two.example.com",
               grade=_grade(conn, theirs, status="running"))
        assert db.settle_finished_runs(conn) == 1
        assert _run_row(conn, mine)["status"] == "done"
        assert _run_row(conn, theirs)["status"] == "grading"

    def test_it_reports_how_many_boards_it_closed(self, conn, account):
        for status in ("grading", "ready"):
            run = _run(conn, account, status=status)
            _entry(conn, run, _p(1), app_url="https://one.example.com", grade=_grade(conn, run))
        assert db.settle_finished_runs(conn) == 2

    def test_a_paused_run_with_work_left_stays_open(self, conn, account):
        # Pause stops the worker claiming, it does not finish anything. Settling here would end the
        # board mid-field while the organizer believes it is merely held.
        run = _run(conn, account, status="grading", paused=True)
        _entry(conn, run, _p(1), app_url="https://one.example.com",
               grade=_grade(conn, run, status="queued"))
        assert db.settle_finished_runs(conn) == 0
