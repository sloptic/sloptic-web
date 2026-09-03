"""Postgres access for the worker: atomic job claim (FOR UPDATE SKIP LOCKED) and result persistence.

Uses a direct Postgres connection (not PostgREST) because the queue needs row-level locking. Connects
with the Supabase service role, so RLS does not apply.
"""

import json
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row

from . import config


@dataclass
class Job:
    id: str
    origin: str
    submitted_url: str
    mode: str


def connect() -> psycopg.Connection:
    return psycopg.connect(config.DATABASE_URL, autocommit=True, row_factory=dict_row)


def save_progress(conn: psycopg.Connection, job_id: str, progress: dict) -> None:
    """Display-only, and deliberately fire-and-forget: a failed progress write must never disturb a
    grade that is otherwise going fine."""
    try:
        payload = json.dumps(progress) if progress is not None else None
        conn.execute("UPDATE grades SET progress = %s WHERE id = %s;", (payload, job_id))
    except Exception:  # noqa: BLE001
        pass


def heartbeat(conn: psycopg.Connection, state: str, reason: str = "", in_flight: str | None = None) -> None:
    """Tell the world this worker is alive, and whether it is claiming.

    Written every poll, including when idle: an empty queue updates nothing else in the schema, so
    without this there is no way to distinguish a healthy idle worker from no worker at all.
    """
    conn.execute(
        """
        INSERT INTO worker_status (id, last_seen, state, reason, in_flight)
        VALUES ('worker', now(), %(state)s, %(reason)s, %(in_flight)s)
        ON CONFLICT (id) DO UPDATE SET
            last_seen = now(), state = EXCLUDED.state,
            reason = EXCLUDED.reason, in_flight = EXCLUDED.in_flight;
        """,
        {"state": state, "reason": reason[:500] or None, "in_flight": in_flight},
    )


def expire_queued_jobs(conn: psycopg.Connection) -> int:
    """Fail grades nobody claimed within the queue timeout, naming the reason.

    Runs in the worker, which covers the cases the worker CAN see (budget spent, breaker tripped, a
    backlog it is grinding through). It cannot cover a dead worker, since a dead worker runs nothing:
    the read path treats a stale heartbeat as the answer there.
    """
    row = conn.execute(
        """
        UPDATE grades
           SET status = 'failed', finished_at = now(),
               error = 'not started within the queue window: no worker was available to run it'
         WHERE status = 'queued'
           AND submitted_at < now() - make_interval(secs => CASE WHEN event_run_id IS NULL
                                                                THEN %(timeout)s
                                                                ELSE %(event_timeout)s END)
     RETURNING 1;
        """,
        {"timeout": config.QUEUE_TIMEOUT_SECONDS,
         "event_timeout": config.EVENT_QUEUE_TIMEOUT_SECONDS},
    ).fetchall()
    return len(row or [])


def reap_stale_jobs(conn: psycopg.Connection) -> int:
    """Return jobs that were claimed but never finished to the queue, or fail them once they have
    burned their attempts. Without this a worker killed mid-grade leaves its row in `running`
    forever, invisible to every other worker and to the submitter, who just watches a page poll.

    Bounded by attempts so a job that reliably kills the worker cannot loop.
    """
    row = conn.execute(
        """
        WITH stale AS (
            SELECT id FROM grades
             WHERE status = 'running'
               AND claimed_at < now() - make_interval(secs => %(stale)s)
        ), requeued AS (
            UPDATE grades SET status = 'queued', claimed_at = NULL
             WHERE id IN (SELECT id FROM stale) AND attempts < %(max_attempts)s
         RETURNING 1
        ), abandoned AS (
            UPDATE grades
               SET status = 'failed', finished_at = now(),
                   error = 'abandoned: worker did not finish within the stale window'
             WHERE id IN (SELECT id FROM stale) AND attempts >= %(max_attempts)s
         RETURNING 1
        )
        SELECT (SELECT count(*) FROM requeued) AS requeued,
               (SELECT count(*) FROM abandoned) AS abandoned;
        """,
        {"stale": config.STALE_JOB_SECONDS, "max_attempts": config.MAX_ATTEMPTS},
    ).fetchone()
    return int(row["requeued"]) + int(row["abandoned"]) if row else 0


def grades_in_last_day(conn: psycopg.Connection, lane: str | None = None) -> int:
    """Grades this worker completed in a rolling 24h, optionally for one lane only.

    Counted in the DB so a restart cannot reset the budget. `lane` is "public" or "event"; the lanes
    have separate allowances, because one field spending the public tier's budget was how a single
    organizer could stop the site for the rest of the day.
    """
    where = {"public": " AND event_run_id IS NULL", "event": " AND event_run_id IS NOT NULL"}.get(lane, "")
    row = conn.execute(
        f"""
        SELECT count(*) AS n FROM grades
         WHERE finished_at > now() - interval '24 hours'
           AND status IN ('done', 'failed'){where};
        """
    ).fetchone()
    return int(row["n"]) if row else 0


def claim_job(conn: psycopg.Connection, lanes: set[str] | None = None) -> Job | None:
    """Atomically take the oldest queued grade and mark it running. Returns None if the queue is empty.

    SKIP LOCKED lets many workers claim disjoint jobs without blocking each other.
    """
    row = conn.execute(
        """
        UPDATE grades
           SET status = 'running', claimed_at = now(), attempts = attempts + 1
         WHERE id = (
               SELECT id FROM grades
                WHERE status = 'queued'
                  -- Only the lanes still inside their daily allowance. A spent event budget must not
                  -- stop a person's single grade, and the reverse.
                  AND ((%(public)s AND event_run_id IS NULL)
                       OR (%(event)s AND event_run_id IS NOT NULL))
                -- A person waiting on ONE grade goes before an event grinding through hundreds.
                -- Without this a 400 app field takes the whole worker for most of a day and every
                -- anonymous submission behind it ages out at the queue timeout, so the site would
                -- look broken to everyone else for as long as one organizer's board took.
                -- A person waiting on ONE grade first, then events by urgency, then by age.
                -- The subquery costs one lookup on a LIMIT 1 claim and keeps the priority in one
                -- place; copying it onto every grade would let the two drift.
                ORDER BY (event_run_id IS NOT NULL),
                         COALESCE((SELECT r.priority FROM event_runs r
                                    WHERE r.id = grades.event_run_id), 0),
                         submitted_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
         )
     RETURNING id, origin, submitted_url, mode;
        """,
        {"public": lanes is None or "public" in lanes,
         "event": lanes is None or "event" in lanes},
    ).fetchone()
    if not row:
        return None
    return Job(id=str(row["id"]), origin=row["origin"], submitted_url=row["submitted_url"], mode=row["mode"])


def get_job(conn: psycopg.Connection, job_id: str) -> Job | None:
    """Read an already-claimed job by id. The child grader gets an id on its command line rather than
    a serialized job, so the row stays the single source of truth for what is being graded."""
    row = conn.execute(
        "SELECT id, origin, submitted_url, mode FROM grades WHERE id = %s;", (job_id,)
    ).fetchone()
    if not row:
        return None
    return Job(id=str(row["id"]), origin=row["origin"], submitted_url=row["submitted_url"], mode=row["mode"])


def _lighthouse_score(outcomes) -> int | None:
    """The Lighthouse performance score from perf-lighthouse-001, or None if it did not run."""
    for o in outcomes or []:
        if isinstance(o, dict) and o.get("probe_id") == "perf-lighthouse-001":
            v = (o.get("evidence") or {}).get("performance")
            if isinstance(v, (int, float)):
                return int(v)
            if isinstance(v, str) and v.isdigit():
                return int(v)
    return None


def save_result(conn: psycopg.Connection, job_id: str, result: dict) -> None:
    """Persist a finished grade and flip the job to done, in one transaction."""
    with conn.transaction():
        conn.execute(
            """
            INSERT INTO results (grade_id, mode, catalog_version, passive_probe_count, slop_score,
                                 axis_slop, coverage, platform, surface, findings,
                                 card, outcomes, axis_potential, lighthouse_score,
                                 blocked_probes, incomplete_axes, bot_challenge, challenge_stage,
                                 retry_blocked_initial, challenge_onset_index,
                                 percentile, percentile_band, curve_version, ranking)
            VALUES (%(grade_id)s, %(mode)s, %(catalog_version)s, %(passive_probe_count)s, %(slop_score)s,
                    %(axis_slop)s, %(coverage)s, %(platform)s, %(surface)s, %(findings)s,
                    %(card)s, %(outcomes)s, %(axis_potential)s, %(lighthouse_score)s,
                    %(blocked_probes)s, %(incomplete_axes)s, %(bot_challenge)s, %(challenge_stage)s,
                    %(retry_blocked_initial)s, %(challenge_onset_index)s,
                    %(percentile)s, %(percentile_band)s, %(curve_version)s, %(ranking)s)
            ON CONFLICT (grade_id) DO UPDATE SET
                slop_score = EXCLUDED.slop_score, axis_slop = EXCLUDED.axis_slop,
                coverage = EXCLUDED.coverage, platform = EXCLUDED.platform,
                surface = EXCLUDED.surface, findings = EXCLUDED.findings,
                card = EXCLUDED.card, outcomes = EXCLUDED.outcomes,
                axis_potential = EXCLUDED.axis_potential,
                lighthouse_score = EXCLUDED.lighthouse_score,
                blocked_probes = EXCLUDED.blocked_probes,
                incomplete_axes = EXCLUDED.incomplete_axes,
                bot_challenge = EXCLUDED.bot_challenge,
                challenge_stage = EXCLUDED.challenge_stage,
                retry_blocked_initial = EXCLUDED.retry_blocked_initial,
                challenge_onset_index = EXCLUDED.challenge_onset_index,
                percentile = EXCLUDED.percentile, percentile_band = EXCLUDED.percentile_band,
                curve_version = EXCLUDED.curve_version, ranking = EXCLUDED.ranking;
            """,
            {
                "grade_id": job_id,
                # Lifted out of the outcomes blob at save time. Reading it back later would mean
                # pulling ~150 probe records with their evidence per app, which a board cannot do.
                "lighthouse_score": _lighthouse_score(result.get("outcomes")),
                "blocked_probes": list(result.get("blocked_probes") or []),
                "incomplete_axes": list(result.get("incomplete_axes") or []),
                # The challenge signal, so a withheld grade is never read back as a clean 0.
                "bot_challenge": bool(result.get("bot_challenge")),
                "challenge_stage": result.get("challenge_stage") or None,
                "retry_blocked_initial": result.get("retry_blocked_initial"),
                "challenge_onset_index": result.get("challenge_onset_index"),
                "mode": result["mode"],
                "catalog_version": result["catalog_version"],
                "passive_probe_count": result.get("passive_probe_count"),
                "slop_score": result["slop_score"],
                "axis_slop": json.dumps(result["axis_slop"]),
                "coverage": json.dumps(result.get("coverage") or {}),
                "platform": json.dumps(result.get("platform") or {}),
                "surface": json.dumps(result.get("surface") or {}),
                "findings": json.dumps(result.get("findings") or []),
                "card": json.dumps(result.get("card") or {}),
                "outcomes": json.dumps(result.get("outcomes") or []),
                "axis_potential": json.dumps(result.get("axis_potential") or {}),
                # All four are NULL when there is no curve, or when rank() declined to place this
                # grade. A missing percentile is an honest absence, never a zero.
                "percentile": (result.get("ranking") or {}).get("percentile"),
                "percentile_band": (result.get("ranking") or {}).get("band"),
                "curve_version": (result.get("ranking") or {}).get("curve_version"),
                "ranking": json.dumps(result["ranking"]) if result.get("ranking") else None,
            },
        )
        conn.execute(
            "UPDATE grades SET status = 'done', finished_at = now(), error = NULL WHERE id = %s;",
            (job_id,),
        )


def mark_failed(conn: psycopg.Connection, job_id: str, message: str) -> None:
    conn.execute(
        "UPDATE grades SET status = 'failed', finished_at = now(), error = %s WHERE id = %s;",
        (message[:1000], job_id),
    )


def sweep_retention(conn: psycopg.Connection) -> tuple[int, int]:
    """Drop expired report bodies and forget stale submitter IP hashes.

    Lives in the worker because the worker is the only thing here that runs on a clock; a Vercel
    route runs when someone visits, which is not a schedule. Both statements are idempotent and
    bounded by an index, so running them every minute costs a no-op once the backlog is clear.

    Returns (reports dropped, ip hashes forgotten). Retention windows are the SQL defaults, so the
    policy lives in migration 0009 rather than being restated here.
    """
    reports = conn.execute("SELECT public.expire_anonymous_reports();").fetchone()
    ips = conn.execute("SELECT public.forget_submitter_ips();").fetchone()
    first = lambda row: (list(row.values())[0] if isinstance(row, dict) else row[0]) if row else 0
    return first(reports), first(ips)


# --- organizer event verification -----------------------------------------------------------------

@dataclass
class Claim:
    id: str
    account_id: str
    slug: str
    token: str
    attempts: int


def claim_event_check(conn: psycopg.Connection) -> Claim | None:
    """Take one event claim that is due for a look, or None.

    SKIP LOCKED for the same reason the grade queue uses it, and the due time is pushed out
    immediately so a slow check cannot be picked up twice while it runs.
    """
    row = conn.execute(
        """
        UPDATE event_claims
           SET attempts = attempts + 1,
               check_due_at = now() + interval '5 minutes'
         WHERE id = (
               SELECT id FROM event_claims
                WHERE status = 'pending' AND check_due_at <= now()
                ORDER BY check_due_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
         )
     RETURNING id, account_id, slug, token, attempts;
        """
    ).fetchone()
    if not row:
        return None
    return Claim(id=str(row["id"]), account_id=str(row["account_id"]), slug=row["slug"],
                 token=row["token"], attempts=row["attempts"])


def record_check(conn: psycopg.Connection, claim_id: str, check_status: str, detail: str,
                 next_delay_seconds: float) -> None:
    """Store what a check saw and when to look again. Never changes `status`: a claim that is not
    verified yet is still pending, and a blocked check is not a failure to report to anyone."""
    conn.execute(
        """
        UPDATE event_claims
           SET check_status = %(cs)s, check_detail = left(%(d)s, 2000), checked_at = now(),
               check_due_at = now() + make_interval(secs => %(delay)s)
         WHERE id = %(id)s;
        """,
        {"cs": check_status, "d": detail, "delay": next_delay_seconds, "id": claim_id},
    )


def verify_claim(conn: psycopg.Connection, claim: "Claim", detail: str, grant_days: int,
                 window_open: bool | None = None, event_state: dict | None = None) -> str:
    """Mark a claim verified and write the grant it earns, in one transaction.

    Returns 'granted', or 'blocked_on_terms' when the account has not accepted the terms. That gate is
    from migration 0007 and it is enforced rather than worked around: the attestation is one of the
    layers the active tier rests on, so a grant issued without it would be a grant nobody agreed to.
    """
    with conn.transaction():
        accepted = conn.execute(
            "SELECT terms_accepted_at FROM profiles WHERE id = %s;", (claim.account_id,)
        ).fetchone()
        if not accepted or accepted["terms_accepted_at"] is None:
            conn.execute(
                """
                UPDATE event_claims
                   SET check_status = 'ok', checked_at = now(),
                       check_detail = left(%(d)s, 2000),
                       check_due_at = now() + interval '1 hour'
                 WHERE id = %(id)s;
                """,
                {"d": f"token found, but the account has not accepted the terms; {detail}",
                 "id": claim.id},
            )
            return "blocked_on_terms"

        conn.execute(
            """
            UPDATE event_claims
               SET status = 'verified', check_status = 'ok', checked_at = now(),
                   verified_at = now(), check_detail = left(%(d)s, 2000),
                   window_open_at_verification = %(open)s, event_state = %(state)s
             WHERE id = %(id)s;
            """,
            {"d": detail, "id": claim.id, "open": window_open,
             "state": json.dumps(event_state) if event_state is not None else None},
        )
        # One live grant per account per scope (0007's unique index), so a re-verification refreshes
        # the window rather than stacking a second authorization nobody would ever revoke.
        conn.execute(
            """
            INSERT INTO grants (account_id, kind, scope, evidence, expires_at)
            VALUES (%(acct)s, 'organizer_event', %(scope)s, %(ev)s,
                    now() + make_interval(days => %(days)s))
            ON CONFLICT (account_id, kind, scope) WHERE revoked_at IS NULL
            DO UPDATE SET granted_at = now(), evidence = EXCLUDED.evidence,
                          expires_at = EXCLUDED.expires_at;
            """,
            {"acct": claim.account_id, "scope": claim.slug, "days": grant_days,
             "ev": json.dumps({"proof": "devpost_event_link", "detail": detail[:2000]})},
        )
    return "granted"


def expire_stale_claims(conn: psycopg.Connection, days: int) -> int:
    """Fail claims whose token never appeared. Only ones we could actually READ: a claim that has only
    ever been blocked is not evidence of anything, and failing it would blame an organizer for our
    inability to reach Devpost."""
    rows = conn.execute(
        """
        UPDATE event_claims
           SET status = 'failed',
               check_detail = left(coalesce(check_detail, '') ||
                   ' | expired: the grading policy link was never found on the event pages', 2000)
         WHERE status = 'pending'
           AND check_status = 'ok'
           AND issued_at < now() - make_interval(days => %(days)s)
     RETURNING 1;
        """,
        {"days": days},
    ).fetchall()
    return len(rows or [])


# --- event runs -----------------------------------------------------------------------------------

@dataclass
class Run:
    id: str
    slug: str
    mode: str
    override: bool


def claim_event_run(conn: psycopg.Connection) -> Run | None:
    """Take one run that needs its field resolved. Marked in progress by the same statement, so a
    slow gallery pull cannot be picked up twice."""
    row = conn.execute(
        """
        UPDATE event_runs SET started_at = coalesce(started_at, now())
         WHERE id = (
               SELECT id FROM event_runs
                WHERE status = 'resolving' AND started_at IS NULL
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
         )
     RETURNING id, slug, mode, override;
        """
    ).fetchone()
    if not row:
        return None
    return Run(id=str(row["id"]), slug=row["slug"], mode=row["mode"], override=row["override"])


def note_resolve_progress(conn: psycopg.Connection, run_id: str, found: int) -> None:
    """How many entries the gallery has yielded so far. Fire and forget: a progress write must never
    disturb a resolve that is otherwise going fine."""
    try:
        conn.execute("UPDATE event_runs SET entries_found = %s WHERE id = %s;", (found, run_id))
    except Exception:  # noqa: BLE001
        pass


def set_run_priority(conn: psycopg.Connection, run_id: str, priority: int) -> None:
    conn.execute("UPDATE event_runs SET priority = %s WHERE id = %s;", (priority, run_id))


def save_field(conn: psycopg.Connection, run_id: str, entries: list, complete: bool,
               detail: str) -> None:
    """Store the resolved field and mark the run ready for the organizer to look at.

    `gallery_complete` travels with it rather than being inferred from a count: a short list and a
    short list we know about are different facts, and only one of them is safe to rank.
    """
    with conn.transaction():
        conn.execute("DELETE FROM event_entries WHERE run_id = %s;", (run_id,))
        for e in entries:
            conn.execute(
                """INSERT INTO event_entries (run_id, project_url, app_url, skip_reason)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (run_id, project_url) DO NOTHING;""",
                (run_id, e.project_url, e.app_url, e.skip_reason),
            )
        conn.execute(
            """UPDATE event_runs
                  SET status = 'ready', entries_found = %(n)s, gallery_complete = %(c)s,
                      detail = left(%(d)s, 2000), resolved_at = now()
                WHERE id = %(id)s;""",
            {"n": len(entries), "c": complete, "d": detail, "id": run_id},
        )


def fail_run(conn: psycopg.Connection, run_id: str, detail: str) -> None:
    conn.execute(
        "UPDATE event_runs SET status = 'failed', detail = left(%s, 2000), finished_at = now() WHERE id = %s;",
        (detail, run_id),
    )


def settle_finished_runs(conn: psycopg.Connection) -> int:
    """Mark a run done once every gradeable entry has been graded and none is still in flight.

    Counted from the rows rather than tracked as the run goes, so a worker restart or a reaped job
    cannot leave a finished board reading as still grading.

    BOTH conditions are needed. "Nothing in flight" alone was enough while a run queued its whole
    field at once, but an organizer grading app by app as each team finishes demoing has long gaps
    with nothing running, and the run would settle after the first one and report a board of 1.
    """
    rows = conn.execute(
        """
        UPDATE event_runs r
           SET status = 'done', finished_at = now()
         WHERE r.status = 'grading'
           AND NOT EXISTS (
                 SELECT 1 FROM grades g
                  WHERE g.event_run_id = r.id AND g.status IN ('queued', 'running'))
           AND NOT EXISTS (
                 SELECT 1 FROM event_entries e
                  WHERE e.run_id = r.id AND e.skip_reason IS NULL AND e.grade_id IS NULL)
     RETURNING 1;
        """
    ).fetchall()
    return len(rows or [])


def may_grade_actively(conn: psycopg.Connection, job_id: str) -> tuple[bool, str]:
    """May this job send attack traffic, checked NOW rather than when it was queued?

    Returns (allowed, why not). Re-checked here because a grant is time boxed and revocable, and a
    field of 200 entries can sit in the queue for hours: the authorization that was live at confirm
    time may have expired, been revoked, or had its event removed before this entry's turn came.
    CLAUDE.md requires the check before each active grade, and this is the last place it can happen.

    Three ways to be allowed, all ACCOUNT bound. An origin grant covers a domain the account proved
    it owns. An event grant covers entries of an event the account proved it runs, and the grade must
    actually belong to a run of that event, so a grant for one event cannot authorize an unrelated
    URL. Operator admin covers an event run that was created under admin privilege, re-checked here
    against the live allowlist: the run carrying admin=true is not enough on its own, because a
    privilege removed while the field sat queued must stop the next entry, exactly as a revoked grant
    does.
    """
    row = conn.execute(
        """
        SELECT g.account_id, g.origin, p.email AS account_email,
               r.slug AS event_slug, r.admin AS run_admin
          FROM grades g
          LEFT JOIN event_runs r ON r.id = g.event_run_id
          LEFT JOIN profiles p ON p.id = g.account_id
         WHERE g.id = %s;
        """,
        (job_id,),
    ).fetchone()
    if not row:
        return False, "the grade row is gone"
    if not row["account_id"]:
        return False, "no account owns this grade"

    if row["event_slug"]:
        live = conn.execute(
            """
            SELECT 1 FROM grants
             WHERE account_id = %s AND kind = 'organizer_event' AND scope = %s
               AND revoked_at IS NULL AND expires_at > now();
            """,
            (row["account_id"], row["event_slug"]),
        ).fetchone()
        if live:
            return True, ""
        # Admin is the exception to "an event run needs an organizer grant". The run must have been
        # created as an admin run AND the account must still be on the allowlist now, both, so a flag
        # left on a row cannot authorize by itself and neither can a bare membership.
        email = (row["account_email"] or "").strip().lower()
        if row["run_admin"] and email and email in config.ADMIN_ACCOUNTS:
            return True, ""
        return False, f"no live grant for event {row['event_slug']}"

    live = conn.execute(
        """
        SELECT 1 FROM grants
         WHERE account_id = %s AND kind = 'app_origin' AND scope = %s
           AND revoked_at IS NULL AND expires_at > now();
        """,
        (row["account_id"], row["origin"]),
    ).fetchone()
    if live:
        return True, ""
    return False, f"no live grant for {row['origin']}"


# --- recovering a WAF-blocked probe tail ----------------------------------------------------------

def schedule_retry(conn: psycopg.Connection, job_id: str, blocked: list, delay_s: float,
                   max_passes: int) -> bool:
    """Book a second pass over the probes a challenge stopped, if there are any and passes remain.

    Returns whether one was booked. A grade with nothing blocked, or one that has already had its
    passes, simply carries no retry, which is the ordinary case.
    """
    if not blocked:
        return False
    row = conn.execute(
        """
        UPDATE grades
           SET retry_due_at = now() + make_interval(secs => %(delay)s)
         WHERE id = %(id)s AND retry_passes < %(max)s
     RETURNING 1;
        """,
        {"id": job_id, "delay": delay_s, "max": max_passes},
    ).fetchone()
    return bool(row)


@dataclass
class Retry:
    grade_id: str
    origin: str
    mode: str
    blocked: list
    passes: int


def claim_retry(conn: psycopg.Connection, lock_s: float) -> Retry | None:
    """Take one grade whose blocked tail is due for another pass.

    The due time is pushed out by the claim itself, so a slow pass cannot be picked up twice, and the
    pass counter increments here rather than on success: a pass that crashes still counts, or a
    reliably-crashing grade would retry for ever. That push is only a VISIBILITY LOCK, sized to
    outlive the worst pass; the next pass's cooldown is booked explicitly once the pass's outcome is
    known, so the cadence is 12 then 16 regardless of how long the pass in between actually ran.
    """
    row = conn.execute(
        """
        UPDATE grades g
           SET retry_passes = g.retry_passes + 1,
               retry_due_at = now() + make_interval(secs => %(lock)s)
         WHERE g.id = (
               SELECT g2.id FROM grades g2
                 JOIN results r ON r.grade_id = g2.id
                WHERE g2.retry_due_at IS NOT NULL AND g2.retry_due_at <= now()
                  AND g2.status = 'done'
                  AND array_length(r.blocked_probes, 1) > 0
                ORDER BY g2.retry_due_at
                FOR UPDATE OF g2 SKIP LOCKED
                LIMIT 1
         )
     RETURNING g.id, g.origin, g.mode, g.retry_passes,
               (SELECT r2.blocked_probes FROM results r2 WHERE r2.grade_id = g.id) AS blocked;
        """,
        {"lock": lock_s},
    ).fetchone()
    if not row:
        return None
    return Retry(grade_id=str(row["id"]), origin=row["origin"], mode=row["mode"],
                 blocked=list(row["blocked"] or []), passes=row["retry_passes"])


def clear_retry(conn: psycopg.Connection, job_id: str) -> None:
    """Stop asking. Either the tail came back or it is not going to."""
    conn.execute("UPDATE grades SET retry_due_at = NULL WHERE id = %s;", (job_id,))


def load_result(conn: psycopg.Connection, grade_id: str) -> dict | None:
    """The stored result in the shape save_result writes, so a merge can hand it straight back."""
    row = conn.execute(
        """SELECT mode, catalog_version, passive_probe_count, slop_score, axis_slop, coverage,
                  platform, surface, findings, card, outcomes, axis_potential, lighthouse_score,
                  blocked_probes, incomplete_axes, percentile, percentile_band, curve_version, ranking
             FROM results WHERE grade_id = %s;""",
        (grade_id,),
    ).fetchone()
    return dict(row) if row else None
