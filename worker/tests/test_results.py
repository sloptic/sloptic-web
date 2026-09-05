"""Storing a finished grade, and the last check on whether it was allowed to be that kind of grade.

Three things live here, and they are the same story told at three points.

save_result / load_result are the report. Everything the report page shows comes out of this row, so
a column the worker never writes, or writes in a shape the reader does not expect, is a broken
report rather than a failed test. The challenge and retry columns matter most: a grade a WAF cut
short must never read back as a clean zero, and a reload that wiped them was a real bug.

save_progress is display only. It exists to explain a long silence and it must never be able to
touch a score, a status or a stored result, whatever it is handed.

may_grade_actively is the last place anyone asks whether attack traffic may be sent at this app, and
it is asked immediately before the payloads go out (grade_child). CLAUDE.md makes the rule: the
grant is ACCOUNT BOUND, and a verified origin is NEVER globally open. Alice verifying alice.com
authorizes Alice; Mallory submitting alice.com gets the passive floor. Time boxed, revocable, scoped
to one origin (scheme + host + port), re-checked here because a field of 200 entries can sit queued
for hours after the authorization it was queued under has gone.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import psycopg
import pytest

from sloptic_web_worker import config, db


# --- rows ------------------------------------------------------------------------------------

def _grade(conn, *, origin="https://alices-app.com", status="running", mode="passive",
           account=None, run=None, error=None):
    row = conn.execute(
        """INSERT INTO grades (origin, submitted_url, mode, status, account_id, event_run_id, error)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (origin, origin, mode, status, account, run, error),
    ).fetchone()
    return str(row["id"])


def _user(conn, email="mallory@example.com"):
    row = conn.execute("INSERT INTO auth.users (email) VALUES (%s) RETURNING id", (email,)).fetchone()
    return row["id"]


def _profile(conn, account, email):
    """may_grade_actively reads the admin allowlist by email, which lives on the profile row."""
    conn.execute("INSERT INTO profiles (id, email) VALUES (%s, %s)", (account, email))


def _grant(conn, account, kind, scope, *, expires="now() + interval '90 days'", revoked=False):
    conn.execute(
        f"""INSERT INTO grants (account_id, kind, scope, expires_at, revoked_at)
            VALUES (%s, %s, %s, {expires}, {'now()' if revoked else 'NULL'})""",
        (account, kind, scope),
    )


def _run(conn, account, *, slug="hack", mode="active", status="grading", admin=False):
    row = conn.execute(
        """INSERT INTO event_runs (account_id, slug, mode, status, admin)
           VALUES (%s, %s, %s, %s, %s) RETURNING id""",
        (account, slug, mode, status, admin),
    ).fetchone()
    return str(row["id"])


def _entry(conn, run, project, app_url=None, skip_reason=None):
    conn.execute(
        "INSERT INTO event_entries (run_id, project_url, app_url, skip_reason) VALUES (%s, %s, %s, %s)",
        (run, project, app_url, skip_reason),
    )


# --- payloads --------------------------------------------------------------------------------

def _ranking(percentile=37, band="middle", curve="passive-2026.1"):
    """What ranking.rank_passive hands back: the whole rank() payload, with the headline numbers the
    result row denormalizes out of it."""
    return {"percentile": percentile, "band": band, "curve_version": curve,
            "cleaner_than_pct": 61, "axis": {"security": 40}}


def _payload(**over):
    """A finished passive grade in the shape grader._run_grade returns."""
    result = {
        "mode": "passive",
        "catalog_version": "sloptic-2.2.0",
        # The 44 check floor. The reader shows it, and the passive curve only speaks for this number.
        "passive_probe_count": 44,
        "slop_score": 21.6,
        "axis_slop": {"security": 12.8, "qa": 8.8, "performance": 0.0},
        "coverage": {"applied": ["sec-headers-001"], "probes_total": 44},
        "platform": {"builder": "vercel"},
        "surface": {"routes": ["/"]},
        "findings": [{"probe_id": "sec-headers-001", "bundle": "security", "category": "headers",
                      "penalty": 3, "reason": "no CSP", "target": "/", "evidence": {}}],
        "card": {"items": [{"probe_id": "sec-headers-001", "expected": "a CSP"}]},
        "outcomes": [{"probe_id": "sec-headers-001", "bundle": "security", "outcome": "slop_detected",
                      "penalty": 3, "evidence": {}}],
        "axis_potential": {"security": 40.0, "qa": 30.0, "performance": 20.0},
        "blocked_probes": [],
        "incomplete_axes": [],
        "bot_challenge": False,
        "challenge_stage": "",
        "retry_blocked_initial": None,
        "challenge_onset_index": None,
        "ranking": None,
    }
    result.update(over)
    return result


def _row(conn, grade_id):
    return conn.execute("SELECT * FROM results WHERE grade_id = %s", (grade_id,)).fetchone()


def _grade_row(conn, grade_id):
    return conn.execute("SELECT * FROM grades WHERE id = %s", (grade_id,)).fetchone()


# The columns web/app/api/grade/[id]/route.ts selects to render a report. The worker is the only
# writer of this table, so anything the reader asks for and the worker never writes is a hole in the
# report rather than a missing test.
REPORT_COLUMNS = [
    "mode", "catalog_version", "passive_probe_count", "slop_score", "axis_slop", "axis_potential",
    "coverage", "platform", "surface", "findings", "card", "outcomes", "percentile",
    "percentile_band", "curve_version", "ranking", "blocked_probes", "incomplete_axes",
    "bot_challenge", "challenge_stage", "retry_blocked_initial", "challenge_onset_index",
]


class TestSaveResult:
    def test_a_saved_result_flips_the_job_to_done_and_clears_the_error_it_was_carrying(self, conn):
        # A retried grade can reach here with an error from an earlier attempt still on the row, and
        # the report page renders grade.error whatever the status says: a stale message under a
        # finished grade reads as a failure that did not happen.
        gid = _grade(conn, error="worker error: previous attempt died")
        db.save_result(conn, gid, _payload())
        row = _grade_row(conn, gid)
        assert row["status"] == "done"
        assert row["finished_at"] is not None
        assert row["error"] is None

    def test_the_decimal_slop_score_survives_the_write(self, conn):
        # Migration 0008 exists for this: stored as an int, 21.6 became 22 while axis_slop kept its
        # decimals, so the headline contradicted the breakdown printed underneath it.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload())
        row = _row(conn, gid)
        assert row["slop_score"] == Decimal("21.6")
        assert sum(Decimal(str(v)) for v in row["axis_slop"].values()) == row["slop_score"]

    def test_every_column_the_report_page_reads_is_written(self, conn):
        # A grade that carries something in every field: ranked, challenged, retried. The columns
        # that are legitimately empty on an ordinary grade (no challenge, no recovery pass) have
        # their own test below; this one is about the worker writing what the reader selects.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload(ranking=_ranking(), bot_challenge=True,
                                           challenge_stage="probing", challenge_onset_index=61,
                                           retry_blocked_initial=2, blocked_probes=["sec-sqli-001"],
                                           incomplete_axes=["security"]))
        row = _row(conn, gid)
        missing = [c for c in REPORT_COLUMNS if row.get(c) is None]
        assert missing == [], f"the reader selects these and the worker stored nothing: {missing}"

    def test_a_second_save_for_the_same_grade_updates_the_one_row(self, conn):
        # A retry pass merges and saves again. Two rows would make "the report" ambiguous, and the
        # reader uses maybeSingle(), which errors rather than picking one.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload())
        db.save_result(conn, gid, _payload(slop_score=9.0, axis_slop={"security": 9.0, "qa": 0, "performance": 0}))
        n = conn.execute("SELECT count(*) AS n FROM results WHERE grade_id = %s", (gid,)).fetchone()["n"]
        assert n == 1
        assert _row(conn, gid)["slop_score"] == Decimal("9.0")

    def test_a_second_save_replaces_the_challenge_and_retry_columns_rather_than_leaving_the_old_ones(self, conn):
        # The recovery pass is the whole reason these columns move: a tail that came back clean must
        # stop reading as blocked, or the report keeps a limited grade limited for ever.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload(bot_challenge=True, challenge_stage="probing",
                                           blocked_probes=["sec-sqli-001", "sec-xss-001"],
                                           incomplete_axes=["security"]))
        db.save_result(conn, gid, _payload(bot_challenge=False, challenge_stage="",
                                           blocked_probes=[], incomplete_axes=[],
                                           retry_blocked_initial=2))
        row = _row(conn, gid)
        assert row["bot_challenge"] is False
        assert row["challenge_stage"] is None
        assert row["blocked_probes"] == []
        assert row["incomplete_axes"] == []
        assert row["retry_blocked_initial"] == 2

    def test_a_withheld_grade_keeps_the_signal_that_says_it_is_not_a_measurement(self, conn):
        # Migration 0020's whole point: a grade whose every probe a challenge blocked was stored as
        # slop 0 / done, and the event board then ranked it as the cleanest app in the field.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload(
            slop_score=0.0, axis_slop={"security": 0, "qa": 0, "performance": 0},
            coverage={"applied": [], "probes_total": 44},
            bot_challenge=True, challenge_stage="entry", challenge_onset_index=47,
            blocked_probes=["sec-headers-001"], incomplete_axes=["security", "qa", "performance"]))
        row = _row(conn, gid)
        assert row["bot_challenge"] is True
        assert row["challenge_stage"] == "entry"
        # How far it got, so "no score" can say "stopped at check 47" instead of implying nothing ran.
        assert row["challenge_onset_index"] == 47
        assert row["incomplete_axes"] == ["security", "qa", "performance"]

    def test_an_ordinary_grade_records_no_challenge_rather_than_an_unknown(self, conn):
        # bot_challenge is NOT NULL by design: "we did not see a challenge" and "nobody asked" must
        # not be the same value on a column the report reads as a warning.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload())
        row = _row(conn, gid)
        assert row["bot_challenge"] is False
        assert row["blocked_probes"] == []
        assert row["incomplete_axes"] == []
        # NULL until a recovery pass has actually run, so "recovered P of M" is never invented.
        assert row["retry_blocked_initial"] is None
        assert row["challenge_onset_index"] is None

    def test_the_lighthouse_score_is_lifted_out_of_the_outcomes_at_save_time(self, conn):
        # Kept as a column because a board cannot pull ~150 probe records with their evidence per app
        # just to show one number.
        gid = _grade(conn)
        outcomes = _payload()["outcomes"] + [
            {"probe_id": "perf-lighthouse-001", "bundle": "performance", "outcome": "clean",
             "penalty": 0, "evidence": {"performance": 64}}]
        db.save_result(conn, gid, _payload(outcomes=outcomes))
        assert _row(conn, gid)["lighthouse_score"] == 64

    def test_a_grade_where_lighthouse_did_not_run_stores_no_score_rather_than_a_zero(self, conn):
        # 0 is a real Lighthouse score and a terrible one. Writing it for "did not run" would invent
        # the worst possible performance result out of an absence.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload())
        assert _row(conn, gid)["lighthouse_score"] is None

    def test_a_grade_the_ranker_declined_to_place_carries_no_percentile_at_all(self, conn):
        # An honest absence, never a zero: percentile 0 means "nothing in the population is cleaner",
        # which is the best possible placement, and it is the value an unranked grade would get if
        # these were defaulted.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload(ranking=None))
        row = _row(conn, gid)
        assert row["percentile"] is None
        assert row["percentile_band"] is None
        assert row["curve_version"] is None
        assert row["ranking"] is None

    def test_the_headline_percentile_columns_come_from_the_ranking_payload(self, conn):
        # The reader shows the columns and the page reads the jsonb; if they disagreed the same
        # report would state two different placements.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload(ranking=_ranking(percentile=12, band="cleanest")))
        row = _row(conn, gid)
        assert (row["percentile"], row["percentile_band"]) == (12, "cleanest")
        assert row["curve_version"] == row["ranking"]["curve_version"] == "passive-2026.1"

    def test_a_passive_grade_is_stored_against_the_passive_curve_and_the_battery_it_ran(self, conn):
        # A passive grade is a DIFFERENT measurement: 44 probes, ranked on passive-2026.1. The stored
        # curve version is what lets the page label it "passive floor" rather than quoting the full
        # battery's population at someone who never ran it.
        gid = _grade(conn, mode="passive")
        db.save_result(conn, gid, _payload(ranking=_ranking(curve="passive-2026.1")))
        row = _row(conn, gid)
        assert row["mode"] == "passive"
        assert row["passive_probe_count"] == 44
        assert row["curve_version"] == "passive-2026.1"
        assert row["curve_version"] != "2026.3"

    def test_a_full_grade_records_the_full_curve_beside_its_mode(self, conn):
        # The pair travels together on purpose: mode alone does not say which ruler produced the
        # number, and a percentile without its curve version cannot be told apart from a later one.
        gid = _grade(conn, mode="active")
        db.save_result(conn, gid, _payload(mode="active", passive_probe_count=102,
                                           ranking=_ranking(curve="2026.3")))
        row = _row(conn, gid)
        assert (row["mode"], row["curve_version"]) == ("active", "2026.3")

    def test_a_result_cannot_be_stored_for_a_grade_that_does_not_exist(self, conn):
        # The report is only reachable through its grade, so an orphan row is a report nobody can
        # read and a score in the population that no submission accounts for.
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            db.save_result(conn, str(uuid.uuid4()), _payload())

    def test_a_grade_is_never_marked_done_when_its_report_failed_to_store(self, conn):
        # Both statements are one transaction. A done grade with no results row renders as a report
        # that expired, which tells someone their grade is gone over a write that simply failed.
        gid = _grade(conn)
        with pytest.raises(psycopg.errors.NotNullViolation):
            db.save_result(conn, gid, _payload(catalog_version=None))
        assert _grade_row(conn, gid)["status"] == "running"
        assert _row(conn, gid) is None


class TestLoadResult:
    def test_a_grade_with_no_report_loads_as_nothing(self, conn):
        gid = _grade(conn)
        assert db.load_result(conn, gid) is None

    def test_a_stored_result_comes_back_whole(self, conn):
        gid = _grade(conn)
        sent = _payload(ranking=_ranking(), bot_challenge=True, challenge_stage="probing",
                        blocked_probes=["sec-sqli-001"], incomplete_axes=["security"],
                        retry_blocked_initial=3, challenge_onset_index=61)
        db.save_result(conn, gid, sent)
        got = db.load_result(conn, gid)
        assert got["mode"] == sent["mode"]
        assert got["catalog_version"] == sent["catalog_version"]
        assert got["passive_probe_count"] == sent["passive_probe_count"]
        assert float(got["slop_score"]) == sent["slop_score"]
        assert got["axis_slop"] == sent["axis_slop"]
        assert got["coverage"] == sent["coverage"]
        assert got["platform"] == sent["platform"]
        assert got["surface"] == sent["surface"]
        assert got["findings"] == sent["findings"]
        assert got["card"] == sent["card"]
        assert got["outcomes"] == sent["outcomes"]
        assert got["axis_potential"] == sent["axis_potential"]
        assert got["ranking"] == sent["ranking"]

    def test_the_challenge_and_retry_columns_come_back_too(self, conn):
        # Wiping these on reload was a real bug: the merge hands the loaded dict straight back to
        # save_result, so anything load_result drops is deleted from the report by the next pass,
        # and what it drops here is exactly the evidence that the grade was cut short.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload(bot_challenge=True, challenge_stage="probing",
                                           blocked_probes=["sec-sqli-001", "sec-upload-002"],
                                           incomplete_axes=["security"],
                                           retry_blocked_initial=5, challenge_onset_index=61))
        got = db.load_result(conn, gid)
        assert got["bot_challenge"] is True
        assert got["challenge_stage"] == "probing"
        assert got["blocked_probes"] == ["sec-sqli-001", "sec-upload-002"]
        assert got["incomplete_axes"] == ["security"]
        assert got["retry_blocked_initial"] == 5
        assert got["challenge_onset_index"] == 61

    def test_a_reload_and_resave_loses_nothing(self, conn):
        # Exactly what a recovery pass does: load the stored result, merge the tail into it, save it
        # back. Every field the round trip drops silently leaves the report on the next pass.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload(ranking=_ranking(), bot_challenge=True,
                                           challenge_stage="probing", blocked_probes=["sec-sqli-001"],
                                           incomplete_axes=["security"], retry_blocked_initial=4,
                                           challenge_onset_index=61))
        first = db.load_result(conn, gid)
        db.save_result(conn, gid, dict(first))
        again = db.load_result(conn, gid)
        assert again == first

    def test_a_reloaded_result_carries_the_lighthouse_score_forward(self, conn):
        # It is derived from outcomes at save time, so a resave only keeps it if the outcomes came
        # back intact. A silently vanishing performance number would read as "Lighthouse never ran".
        gid = _grade(conn)
        outcomes = _payload()["outcomes"] + [
            {"probe_id": "perf-lighthouse-001", "bundle": "performance", "outcome": "clean",
             "penalty": 0, "evidence": {"performance": 64}}]
        db.save_result(conn, gid, _payload(outcomes=outcomes))
        db.save_result(conn, gid, dict(db.load_result(conn, gid)))
        assert _row(conn, gid)["lighthouse_score"] == 64

    def test_loading_names_one_grade_and_not_its_neighbour(self, conn):
        a = _grade(conn, origin="https://a.example.com")
        b = _grade(conn, origin="https://b.example.com")
        db.save_result(conn, a, _payload(slop_score=1.0, axis_slop={"security": 1.0, "qa": 0, "performance": 0}))
        db.save_result(conn, b, _payload(slop_score=2.0, axis_slop={"security": 2.0, "qa": 0, "performance": 0}))
        assert float(db.load_result(conn, a)["slop_score"]) == 1.0
        assert float(db.load_result(conn, b)["slop_score"]) == 2.0


class TestSaveProgress:
    def test_the_running_grade_shows_where_it_has_got_to(self, conn):
        gid = _grade(conn)
        db.save_progress(conn, gid, {"phase": "probing", "label": "", "done": 12, "total": 44,
                                     "probe": "sec-headers-001", "preview": 8.5})
        p = _grade_row(conn, gid)["progress"]
        assert p["done"] == 12 and p["total"] == 44
        assert p["phase"] == "probing"

    def test_progress_clears_to_nothing_at_the_end_of_a_grade(self, conn):
        # grade_child clears it in a finally. The value must be SQL NULL, not a json null: the report
        # renders progress only while the grade runs, and a leftover blob under a finished grade
        # would show a stale probe count next to the final score.
        gid = _grade(conn)
        db.save_progress(conn, gid, {"phase": "probing", "done": 12, "total": 44})
        db.save_progress(conn, gid, None)
        assert _grade_row(conn, gid)["progress"] is None

    def test_progress_cannot_touch_the_score_the_status_or_the_stored_report(self, conn):
        # It is display only. Nothing joins or filters on it, and nothing it carries may reach a
        # measurement: a liveness blob that could move a score would be a score anyone can write.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload(ranking=_ranking()))
        before = _row(conn, gid)
        db.save_progress(conn, gid, {"phase": "probing", "done": 44, "total": 44,
                                     "slop_score": 0, "percentile": 0, "preview": 999})
        assert _row(conn, gid) == before
        assert _grade_row(conn, gid)["status"] == "done"

    def test_a_progress_write_that_cannot_be_stored_never_disturbs_the_grade(self, conn):
        # Deliberately fire and forget. A grade that is otherwise going fine must not die because a
        # cosmetic UPDATE failed, and the connection must survive to write the result.
        gid = _grade(conn)
        db.save_progress(conn, gid, {"phase": object()})       # not serializable
        db.save_progress(conn, "not-a-uuid", {"phase": "probing"})
        db.save_result(conn, gid, _payload())
        assert _grade_row(conn, gid)["status"] == "done"

    def test_progress_for_a_grade_that_is_gone_changes_nothing(self, conn):
        # A cancelled or deleted grade can still have a child mid-flight reporting into it.
        db.save_progress(conn, str(uuid.uuid4()), {"phase": "probing"})
        assert conn.execute("SELECT count(*) AS n FROM grades").fetchone()["n"] == 0

    def test_progress_names_one_grade_and_not_another(self, conn):
        a = _grade(conn, origin="https://a.example.com")
        b = _grade(conn, origin="https://b.example.com")
        db.save_progress(conn, a, {"phase": "probing", "done": 3})
        assert _grade_row(conn, b)["progress"] is None


class TestFieldPrior:
    def test_it_reads_the_field_the_organizer_is_looking_at(self, conn, account):
        run = _run(conn, account, mode="passive")
        _entry(conn, run, "https://devpost.com/software/one", "https://one.example.com")
        _entry(conn, run, "https://devpost.com/software/two", "https://two.example.com")
        prior = db.field_prior(conn, run)
        assert prior == {
            "https://devpost.com/software/one": ("https://one.example.com", None),
            "https://devpost.com/software/two": ("https://two.example.com", None),
        }

    def test_a_skipped_entry_keeps_its_reason(self, conn, account):
        # The refresh diff compares against this. Without the reason, an entry that was skipped for
        # the same cause last pass reads as modified every single time.
        run = _run(conn, account, mode="passive")
        _entry(conn, run, "https://devpost.com/software/three", None, "no deployed app")
        assert db.field_prior(conn, run) == {
            "https://devpost.com/software/three": (None, "no deployed app")}

    def test_it_covers_only_the_run_it_was_asked_about(self, conn, account):
        # Two runs of the same event share project urls. Bleeding one run's rows into another's
        # prior would report a field as unchanged that this run has never resolved.
        mine = _run(conn, account, slug="hack", mode="passive")
        other = _run(conn, account, slug="other", mode="passive")
        _entry(conn, mine, "https://devpost.com/software/one", "https://one.example.com")
        _entry(conn, other, "https://devpost.com/software/two", "https://two.example.com")
        assert list(db.field_prior(conn, mine)) == ["https://devpost.com/software/one"]

    def test_a_run_that_has_never_resolved_has_an_empty_prior(self, conn, account):
        # Empty, not None: the first resolve must be able to treat every entry as new without
        # special casing a missing prior.
        run = _run(conn, account, mode="passive")
        assert db.field_prior(conn, run) == {}


class TestMayGradeActively:
    def test_an_account_that_proved_it_owns_the_origin_may_grade_it_actively(self, conn, account):
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=account)
        _grant(conn, account, "app_origin", "https://alices-app.com")
        assert db.may_grade_actively(conn, gid) == (True, "")

    def test_an_account_with_no_grant_gets_the_passive_floor(self, conn, account):
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=account)
        ok, why = db.may_grade_actively(conn, gid)
        assert ok is False
        assert "alices-app.com" in why

    def test_another_account_s_grant_does_not_authorize_this_one(self, conn, account):
        # The load bearing rule. Alice proved she controls alices-app.com; Mallory submitting the
        # same URL holds nothing, and the grant is "Alice may actively grade this origin", never
        # "this origin is active gradable". A verified origin is NEVER globally open.
        alice, mallory = account, _user(conn)
        _grant(conn, alice, "app_origin", "https://alices-app.com")
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=mallory)
        ok, _ = db.may_grade_actively(conn, gid)
        assert ok is False

    def test_an_expired_grant_no_longer_authorizes_anything(self, conn, account):
        # Grants are time boxed (~90 days) and a field can sit queued for hours: the authorization
        # that was live when the entry was enqueued may be gone by the time its turn comes.
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=account)
        _grant(conn, account, "app_origin", "https://alices-app.com",
               expires="now() - interval '1 second'")
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_a_revoked_grant_stops_the_next_entry(self, conn, account):
        # Revocation has to bite mid-field, or "revoke" means "after this run finishes".
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=account)
        _grant(conn, account, "app_origin", "https://alices-app.com", revoked=True)
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_a_grant_for_one_origin_does_not_reach_another(self, conn, account):
        gid = _grade(conn, origin="https://someone-else.com", mode="active", account=account)
        _grant(conn, account, "app_origin", "https://alices-app.com")
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_a_grant_does_not_spread_across_scheme_host_or_port(self, conn, account):
        # A grant authorizes URLs under the verified ORIGIN: scheme + host + port. A subdomain is a
        # different host (and often someone else's), and a different port is a different service.
        _grant(conn, account, "app_origin", "https://alices-app.com")
        for origin in ("http://alices-app.com", "https://alices-app.com:8443",
                       "https://admin.alices-app.com", "https://alices-app.com.evil.test"):
            gid = _grade(conn, origin=origin, mode="active", account=account)
            assert db.may_grade_actively(conn, gid)[0] is False, origin

    def test_an_anonymous_grade_is_never_active(self, conn):
        # Nothing to bind the authorization to, and nobody to hold to the attestation. The anonymous
        # tier is the passive floor by construction.
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=None)
        ok, why = db.may_grade_actively(conn, gid)
        assert ok is False
        assert "account" in why

    def test_a_grade_row_that_has_gone_is_refused_rather_than_assumed(self, conn):
        # Fail closed: a deleted or cancelled grade must not read as "no reason to refuse".
        ok, why = db.may_grade_actively(conn, str(uuid.uuid4()))
        assert ok is False
        assert why

    def test_a_platform_subdomain_gets_the_passive_floor(self, conn, account):
        # Structural, not a policy toggle: a team on *.vercel.app cannot edit the platform's DNS
        # zone, so the second independent proof is unavailable to them and no live grant can exist.
        # Their path to an active grade is attaching a custom domain.
        for origin in ("https://team-hack.vercel.app", "https://team-hack.netlify.app"):
            gid = _grade(conn, origin=origin, mode="active", account=account)
            assert db.may_grade_actively(conn, gid)[0] is False, origin

    def test_an_organizer_grant_covers_the_entries_of_the_event_it_was_issued_for(self, conn, account):
        run = _run(conn, account, slug="hack")
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        _grant(conn, account, "organizer_event", "hack")
        assert db.may_grade_actively(conn, gid) == (True, "")

    def test_an_organizer_grant_for_one_event_does_not_cover_another_event_s_field(self, conn, account):
        run = _run(conn, account, slug="other-hack")
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        _grant(conn, account, "organizer_event", "hack")
        ok, why = db.may_grade_actively(conn, gid)
        assert ok is False
        assert "other-hack" in why

    def test_another_account_s_organizer_grant_does_not_cover_this_field(self, conn, account):
        # Same account binding as the origin tier: proving you run an event authorizes YOU.
        alice, mallory = account, _user(conn)
        _grant(conn, alice, "organizer_event", "hack")
        run = _run(conn, mallory, slug="hack")
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=mallory, run=run)
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_an_expired_organizer_grant_stops_the_rest_of_the_field(self, conn, account):
        run = _run(conn, account, slug="hack")
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        _grant(conn, account, "organizer_event", "hack", expires="now() - interval '1 day'")
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_a_revoked_organizer_grant_stops_the_rest_of_the_field(self, conn, account):
        run = _run(conn, account, slug="hack")
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        _grant(conn, account, "organizer_event", "hack", revoked=True)
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_an_origin_grant_does_not_stand_in_for_an_organizer_grant(self, conn, account):
        # The kinds prove different things. Owning an app named like an event slug is not running
        # the event, and the two flows collect different evidence.
        run = _run(conn, account, slug="hack")
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        _grant(conn, account, "app_origin", "hack")
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_an_organizer_grant_does_not_stand_in_for_owning_the_app(self, conn, account):
        # The mirror image, and the more dangerous direction: an organizer slug that happens to read
        # like an origin must not authorize attack traffic at a URL nobody proved they own.
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=account)
        _grant(conn, account, "organizer_event", "https://alices-app.com")
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_an_admin_run_needs_the_account_to_be_on_the_live_allowlist(self, conn, account, monkeypatch):
        # The flag records that a run was CREATED under operator privilege; it authorizes nothing on
        # its own. The allowlist is re-read here so a privilege removed while the field sat queued
        # stops the next entry, exactly as a revoked grant does.
        _profile(conn, account, "operator@example.com")
        run = _run(conn, account, slug="hack", admin=True)
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        monkeypatch.setattr(config, "ADMIN_ACCOUNTS", frozenset({"operator@example.com"}))
        assert db.may_grade_actively(conn, gid) == (True, "")
        monkeypatch.setattr(config, "ADMIN_ACCOUNTS", frozenset())
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_the_admin_flag_alone_authorizes_nothing(self, conn, account, monkeypatch):
        _profile(conn, account, "stranger@example.com")
        run = _run(conn, account, slug="hack", admin=True)
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        monkeypatch.setattr(config, "ADMIN_ACCOUNTS", frozenset({"operator@example.com"}))
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_being_on_the_allowlist_does_not_open_a_run_that_is_not_an_admin_run(self, conn, account, monkeypatch):
        # Bare membership is not authorization either: the run must have been created under the
        # privilege AND the account must still hold it. Both, or neither.
        _profile(conn, account, "operator@example.com")
        run = _run(conn, account, slug="hack", admin=False)
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        monkeypatch.setattr(config, "ADMIN_ACCOUNTS", frozenset({"operator@example.com"}))
        assert db.may_grade_actively(conn, gid)[0] is False

    def test_an_account_with_no_profile_row_cannot_reach_the_admin_path(self, conn, account, monkeypatch):
        # The email is the allowlist key. No profile means no email means no match, and an empty
        # string must never match an empty allowlist entry.
        run = _run(conn, account, slug="hack", admin=True)
        gid = _grade(conn, origin="https://team-one.example.com", mode="active",
                     account=account, run=run)
        monkeypatch.setattr(config, "ADMIN_ACCOUNTS", frozenset({""}))
        assert db.may_grade_actively(conn, gid)[0] is False


class TestMarkFailed:
    def test_a_refused_active_grade_is_failed_with_the_reason_on_the_row(self, conn, account):
        # The refusal has to reach the person who submitted it: the report page prints grade.error,
        # and a grade that stops with an empty message reads as the worker breaking.
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=account)
        ok, why = db.may_grade_actively(conn, gid)
        assert ok is False
        db.mark_failed(conn, gid, f"not authorized to grade actively: {why}")
        row = _grade_row(conn, gid)
        assert row["status"] == "failed"
        assert row["finished_at"] is not None
        assert "not authorized" in row["error"]

    def test_a_refusal_writes_no_report(self, conn, account):
        # Nothing was measured, so there must be nothing to rank, share or place on a curve.
        gid = _grade(conn, origin="https://alices-app.com", mode="active", account=account)
        db.mark_failed(conn, gid, "not authorized to grade actively: no live grant")
        assert db.load_result(conn, gid) is None

    def test_a_grade_that_already_landed_its_result_is_not_turned_into_a_failure(self, conn):
        # The supervisor's harvest is one poll stale, so it can decide a grade timed out a breath
        # after the child committed. A finished grade is never a failure.
        gid = _grade(conn)
        db.save_result(conn, gid, _payload())
        db.mark_failed(conn, gid, "timed out")
        row = _grade_row(conn, gid)
        assert row["status"] == "done"
        assert row["error"] is None

    def test_a_cancelled_grade_is_not_relabelled_as_a_failure(self, conn, account):
        # Cancel is a distinct status on purpose: "did not respond" would be a lie about who stopped
        # the grade, and the organizer is owed the truth about their own run.
        run = _run(conn, account)
        gid = _grade(conn, status="cancelled", account=account, run=run,
                     error="cancelled by the organizer")
        db.mark_failed(conn, gid, "worker error: child died")
        row = _grade_row(conn, gid)
        assert row["status"] == "cancelled"
        assert row["error"] == "cancelled by the organizer"

    def test_a_grade_waiting_in_the_queue_is_not_failed_by_a_straggler(self, conn):
        # Only a RUNNING grade can fail. A requeued or newly submitted one being failed by a late
        # message about a previous attempt would kill a grade that has not been tried yet.
        gid = _grade(conn, status="queued")
        db.mark_failed(conn, gid, "worker error: child died")
        assert _grade_row(conn, gid)["status"] == "queued"

    def test_a_very_long_reason_is_trimmed_rather_than_lost(self, conn):
        # The message can carry a whole exception chain. Storing it whole bloats every row the queue
        # reads; refusing it would lose the reason the grade stopped.
        gid = _grade(conn)
        db.mark_failed(conn, gid, "x" * 5000)
        assert len(_grade_row(conn, gid)["error"]) == 1000
