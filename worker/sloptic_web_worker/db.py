"""Postgres access for the worker: atomic job claim (FOR UPDATE SKIP LOCKED) and result persistence.

Uses a direct Postgres connection (not PostgREST) because the queue needs row-level locking. Connects
with the Supabase service role, so RLS does not apply.
"""

import json
from dataclasses import dataclass
from datetime import datetime

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
           -- A paused run holds its grades on purpose; expiry may not fail them out from under it.
           -- A cancelled run's stragglers are NOT failed here either, but they are not left to poll
           -- for ever: cancel_queued_on_cancelled_runs below marks them cancelled, which is the
           -- truthful status (0024 made it distinct so the row says who stopped it) where this
           -- statement would have blamed a worker that was never the reason.
           AND NOT EXISTS (
                 SELECT 1 FROM event_runs r
                  WHERE r.id = grades.event_run_id AND (r.paused OR r.status = 'cancelled'))
     RETURNING 1;
        """,
        {"timeout": config.QUEUE_TIMEOUT_SECONDS,
         "event_timeout": config.EVENT_QUEUE_TIMEOUT_SECONDS},
    ).fetchall()
    return len(row or [])


def cancel_queued_on_cancelled_runs(conn: psycopg.Connection) -> int:
    """Mark the queued leftovers of a cancelled run cancelled, rather than leaving them to poll.

    claim_job refuses a cancelled run's grades and expire_queued_jobs refuses to age them out, so
    without this they sit queued for ever. It is reachable rather than theoretical: a grade running
    through a cancel that the boot reaper later returns to the queue lands exactly here.

    Cancelled, not failed, and with the organizer named: 0024 made the status distinct so a stopped
    grade does not read as one that broke.
    """
    rows = conn.execute(
        """
        UPDATE grades
           SET status = 'cancelled', finished_at = now(), error = 'cancelled by the organizer'
         WHERE status = 'queued'
           AND EXISTS (SELECT 1 FROM event_runs r
                        WHERE r.id = grades.event_run_id AND r.status = 'cancelled')
     RETURNING 1;
        """
    ).fetchall()
    return len(rows or [])


def reap_abandoned_at_boot(conn: psycopg.Connection, boot: datetime) -> int:
    """Requeue every grade still marked running from before this supervisor started.

    A deploy restarts the service, and systemd takes the whole cgroup: the grade children die hard,
    unable to write a goodbye, so their rows sit at status 'running' with frozen progress. The
    regular reaper would eventually requeue each one as its claim aged past the stale window, but
    that leaves every grade from the old life frozen for up to STALE_JOB_SECONDS after every deploy.
    At boot the answer is unambiguous: nothing running was claimed by THIS supervisor, and the
    supervisor that claimed them no longer exists, so they are requeued at once (attempts still
    count, and a paused run still holds them).

    SINGLE-WORKER assumption, stated loudly: with two boxes, B's boot would requeue A's live
    children. The deployment is one worker; revisit this guard before that ever changes.
    """
    row = conn.execute(
        """
        WITH requeued AS (
            UPDATE grades
               SET status = 'queued', claimed_at = NULL, submitted_at = now()
             WHERE status = 'running' AND claimed_at < %s
             RETURNING 1
        )
        SELECT count(*) AS n FROM requeued;
        """,
        (boot,),
    ).fetchone()
    return int(row["n"])


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
            UPDATE grades SET status = 'queued', claimed_at = NULL, submitted_at = now()
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
                  -- A paused run holds its place: nothing of it is claimed, nothing of it is lost.
                  AND NOT EXISTS (
                        SELECT 1 FROM event_runs r
                         WHERE r.id = grades.event_run_id AND r.paused)
                  AND NOT EXISTS (
                        SELECT 1 FROM event_runs r
                         WHERE r.id = grades.event_run_id AND r.status = 'cancelled')
                  -- An event grade without an entry link lost its link to a regrade, a cancel, or a
                  -- resolver pass that removed its entry mid-enqueue. It is not claimable.
                  AND (event_run_id IS NULL
                       OR EXISTS (SELECT 1 FROM event_entries e WHERE e.grade_id = grades.id))
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
            "UPDATE grades SET status = 'done', finished_at = now(), error = NULL "
            " WHERE id = %s AND status = 'running';",
            (job_id,),
        )


def mark_failed(conn: psycopg.Connection, job_id: str, message: str) -> None:
    # Guarded on status: the child may have committed its result a breath before the supervisor's
    # (one poll stale) harvest decided it had timed out. A finished grade is never a failure.
    conn.execute(
        "UPDATE grades SET status = 'failed', finished_at = now(), error = %s WHERE id = %s AND status = 'running';",
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


# --- owner (domain) verification -----------------------------------------------------------------

@dataclass
class DomainClaim:
    id: str
    account_id: str
    origin: str
    host: str
    token: str
    attempts: int


def claim_domain_check(conn: psycopg.Connection) -> DomainClaim | None:
    """Take one owner claim that is due for a look, or None.

    Same shape as claim_event_check: SKIP LOCKED, and the due time is pushed out immediately so a
    slow check cannot be handed out twice while it runs.
    """
    row = conn.execute(
        """
        UPDATE domain_claims
           SET attempts = attempts + 1,
               check_due_at = now() + interval '5 minutes'
         WHERE id = (
               SELECT id FROM domain_claims
                WHERE status = 'pending' AND check_due_at <= now()
                ORDER BY check_due_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
         )
     RETURNING id, account_id, origin, host, token, attempts;
        """
    ).fetchone()
    if row is None:
        return None
    return DomainClaim(id=str(row["id"]), account_id=str(row["account_id"]), origin=row["origin"],
                       host=row["host"], token=row["token"], attempts=row["attempts"])


def record_domain_check(conn: psycopg.Connection, claim_id: str, file_status: str, dns_status: str,
                        detail: str, retry_in_s: float) -> None:
    """Write what the last look saw, and when to look again.

    The claim stays PENDING. A factor that is merely missing is something the owner is still in the
    middle of publishing, and a blocked one is our failure to look, so neither is a verdict.
    """
    conn.execute(
        """
        UPDATE domain_claims
           SET file_status = %(f)s, dns_status = %(d)s, detail = left(%(det)s, 2000),
               checked_at = now(),
               check_due_at = now() + make_interval(secs => %(retry)s)
         WHERE id = %(id)s;
        """,
        {"f": file_status, "d": dns_status, "det": detail, "retry": retry_in_s, "id": claim_id},
    )


def verify_domain_claim(conn: psycopg.Connection, claim: DomainClaim, detail: str,
                        grant_days: int) -> str:
    """Both factors answered ok: mark the claim verified and write the grant, in one transaction.

    Returns 'granted', or 'blocked_on_terms' when the account has not accepted the terms. Enforced
    rather than worked around, exactly as the event path does it: the attestation is one of the
    layers the active tier rests on, and a grant issued without it is one nobody agreed to.
    """
    with conn.transaction():
        accepted = conn.execute(
            "SELECT terms_accepted_at FROM profiles WHERE id = %s;", (claim.account_id,)
        ).fetchone()
        if not accepted or accepted["terms_accepted_at"] is None:
            conn.execute(
                """
                UPDATE domain_claims
                   SET file_status = 'ok', dns_status = 'ok', checked_at = now(),
                       detail = left(%(d)s, 2000),
                       check_due_at = now() + interval '1 hour'
                 WHERE id = %(id)s;
                """,
                {"d": f"both proofs found, but the account has not accepted the terms; {detail}",
                 "id": claim.id},
            )
            return "blocked_on_terms"

        conn.execute(
            """
            UPDATE domain_claims
               SET status = 'verified', file_status = 'ok', dns_status = 'ok',
                   checked_at = now(), verified_at = now(), detail = left(%(d)s, 2000)
             WHERE id = %(id)s;
            """,
            {"d": detail, "id": claim.id},
        )
        # Scoped to the ORIGIN, which is what a grade compares against, and upserted so a
        # re-verification refreshes the window rather than stacking a second authorization.
        conn.execute(
            """
            INSERT INTO grants (account_id, kind, scope, evidence, expires_at)
            VALUES (%(acct)s, 'app_origin', %(scope)s, %(ev)s,
                    now() + make_interval(days => %(days)s))
            ON CONFLICT (account_id, kind, scope) WHERE revoked_at IS NULL
            DO UPDATE SET granted_at = now(), evidence = EXCLUDED.evidence,
                          expires_at = EXCLUDED.expires_at;
            """,
            {"acct": claim.account_id, "scope": claim.origin, "days": grant_days,
             "ev": json.dumps({"proof": "two_factor_origin_control",
                               "file": f"https://{claim.host}/.well-known/sloptic-verification.txt",
                               "dns": f"_sloptic.{claim.host}",
                               "detail": detail[:2000]})},
        )
    return "granted"


def expire_stale_domain_claims(conn: psycopg.Connection, days: int) -> int:
    """Fail claims whose proofs never appeared, and only ones we could actually LOOK at.

    A claim that has only ever been blocked is evidence of nothing, and failing it would blame an
    owner for our own inability to reach them.
    """
    rows = conn.execute(
        """
        UPDATE domain_claims
           SET status = 'failed',
               detail = left(coalesce(detail, '') ||
                   ' | expired: the proofs were never both found', 2000)
         WHERE status = 'pending'
           AND issued_at < now() - make_interval(days => %s)
           AND (file_status IN ('ok', 'not_found') OR dns_status IN ('ok', 'not_found'))
     RETURNING 1;
        """,
        (days,),
    ).fetchall()
    return len(rows or [])


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
                 window_open: bool | None = None, event_state: dict | None = None,
                 page: str = "", link_text: str = "") -> str:
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
             "ev": json.dumps({"proof": "devpost_event_link", "detail": detail[:2000],
                               "page": page, "link_text": link_text})},
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
    refresh_requested: bool = False


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
     RETURNING id, slug, mode, override, refresh_requested;
        """
    ).fetchone()
    if not row:
        return None
    return Run(id=str(row["id"]), slug=row["slug"], mode=row["mode"], override=row["override"],
               refresh_requested=row["refresh_requested"])


def note_resolve_progress(conn: psycopg.Connection, run_id: str, found: int) -> None:
    """How many entries the gallery has yielded so far. Fire and forget: a progress write must never
    disturb a resolve that is otherwise going fine."""
    try:
        conn.execute("UPDATE event_runs SET entries_found = %s WHERE id = %s;", (found, run_id))
    except Exception:  # noqa: BLE001
        pass


def set_run_priority(conn: psycopg.Connection, run_id: str, priority: int) -> None:
    conn.execute("UPDATE event_runs SET priority = %s WHERE id = %s;", (priority, run_id))


def cancel_run(conn: psycopg.Connection, run_id: str) -> int:
    """Stop a run: its queued grades become 'cancelled', the entries THEY belonged to are unlinked
    (so those apps are gradeable again), and the run is marked cancelled. Returns how many were
    dequeued.

    Nothing in the worker calls this: the web route at /api/events/run/cancel does the work, and the
    supervisor kills the run's running children on its next pass (running_on_cancelled_runs). It is
    kept as the transactional equivalent, so it has to agree with that route rather than drift into
    a second, different meaning of cancel. It previously disagreed twice: it unlinked the entries of
    grades that had FINISHED, which takes an organizer's completed reports off their own board, and
    it had no run-status guard, so it would reopen a settled run and restamp its finished_at.

    Running grades are left attached here on purpose. The supervisor kills them and unlinks them
    itself, which keeps the report-landed-first race in one place.
    """
    with conn.transaction():
        # The run first, and only from a state a cancel may act on. Without this a settled run was
        # reopened as cancelled and its finished_at restamped, while the route answers 409.
        stopped = conn.execute(
            """UPDATE event_runs
                   SET status = 'cancelled', paused = false, finished_at = now()
                 WHERE id = %s AND status IN ('resolving', 'ready', 'grading')
             RETURNING id;""",
            (run_id,),
        ).fetchone()
        if not stopped:
            return 0

        dequeued = conn.execute(
            """
            UPDATE grades
               SET status = 'cancelled', finished_at = now(),
                   error = 'cancelled by the organizer'
             WHERE event_run_id = %s AND status = 'queued'
         RETURNING id;
            """,
            (run_id,),
        ).fetchall()
        ids = [r["id"] for r in dequeued]
        n = len(ids)
        if ids:
            # Only what this call just dequeued, named exactly. Unlinking "anything not running"
            # also swept up every FINISHED grade, so cancelling a part-graded run silently emptied
            # the board of the reports it had already earned.
            conn.execute(
                "UPDATE event_entries SET grade_id = NULL WHERE run_id = %s AND grade_id = ANY(%s);",
                (run_id, ids),
            )
        conn.execute(
            """UPDATE grades
                   SET retry_due_at = NULL
                 WHERE event_run_id = %s AND retry_due_at IS NOT NULL;""",
            (run_id,),
        )
    return n


def running_on_cancelled_runs(conn: psycopg.Connection) -> list[str]:
    """Grade ids still marked running on a run the organizer has cancelled.

    Cancel used to let these finish: a grade is minutes from landing and killing the child loses
    the work. But those finishing children hold concurrency slots, and an organizer who cancels and
    immediately starts a fresh run watches the new one starve behind the OLD run's stragglers for
    their whole remaining wall clock. Cancel now means stop now: the supervisor kills these
    children (see the loop), and the grade is marked cancelled with its entry unlinked, so the app
    is gradeable again under whichever run comes next.
    """
    rows = conn.execute(
        """
        SELECT g.id
          FROM grades g
          JOIN event_runs r ON r.id = g.event_run_id
         WHERE g.status = 'running' AND r.status = 'cancelled';
        """
    ).fetchall()
    return [str(r["id"]) for r in rows]


def mark_cancelled(conn: psycopg.Connection, grade_id: str) -> None:
    """Mark a killed grade cancelled, guarded on running: if the child landed its result in the
    breath before the kill, the report wins and nothing is marked."""
    conn.execute(
        """UPDATE grades
              SET status = 'cancelled', finished_at = now(), error = 'cancelled by the organizer'
             WHERE id = %s AND status = 'running';""",
        (grade_id,),
    )


def unlink_entries_of(conn: psycopg.Connection, grade_ids: list[str]) -> None:
    """Detach entries from killed grades, so those apps are gradeable again.

    A grade that FINISHED keeps its entry. The supervisor guards mark_cancelled on status='running'
    precisely so a report landing in the breath before the kill wins that race, and then passes the
    whole doomed list here: without this clause the winner keeps its report and loses its place on
    the board, which undoes the race it just won.
    """
    if not grade_ids:
        return
    conn.execute(
        """UPDATE event_entries e SET grade_id = NULL
            WHERE e.grade_id = ANY(%s)
              AND NOT EXISTS (SELECT 1 FROM grades g
                               WHERE g.id = e.grade_id AND g.status = 'done');""",
        (grade_ids,),
    )


def field_prior(conn: psycopg.Connection, run_id: str) -> dict:
    """The run's current field rows: project_url -> (app_url, skip_reason). A refresh compares its
    fresh resolve against this, so "new" and "modified" describe the FIELD the organizer saw, not a
    cache that may only have started existing this very pass."""
    rows = conn.execute(
        "SELECT project_url, app_url, skip_reason FROM event_entries WHERE run_id = %s;",
        (run_id,),
    ).fetchall()
    return {r["project_url"]: (r["app_url"], r["skip_reason"]) for r in rows}


def save_field(conn: psycopg.Connection, run_id: str, entries: list, complete: bool,
               detail: str, refresh_counts: tuple[int, int] | None = None) -> None:
    """Store the resolved field and mark the run ready for the organizer to look at.

    MERGE, not replace, so a re-resolve (the refresh button) cannot orphan graded work: an entry
    that already has a grade keeps its row untouched, an ungraded one takes the fresh app_url and
    skip decision, and an entry the gallery no longer lists is dropped only if nothing was ever
    graded on it. A fresh run's table is empty, so the first resolve behaves exactly like an insert.

    `gallery_complete` travels with it rather than being inferred from a count: a short list and a
    short list we know about are different facts, and only one of them is safe to rank.
    """
    with conn.transaction():
        # The run row FIRST, and bail if it matched nothing. Everything below writes to a field the
        # organizer is meant to authorise, and a cancel landing mid-resolve used to leave this
        # writing entries into (and pruning entries out of) a run that was already stopped. The
        # status predicate lives here rather than only on the update at the end.
        claimed = conn.execute(
            "SELECT 1 FROM event_runs WHERE id = %s AND status = 'resolving' FOR UPDATE;",
            (run_id,),
        ).fetchone()
        if not claimed:
            return

        for e in entries:
            conn.execute(
                """INSERT INTO event_entries (run_id, project_url, app_url, skip_reason)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (run_id, project_url) DO UPDATE
                        SET app_url = EXCLUDED.app_url, skip_reason = EXCLUDED.skip_reason
                      WHERE event_entries.grade_id IS NULL;""",
                (run_id, e.project_url, e.app_url, e.skip_reason),
            )
        # Prune only what a COMPLETE listing contradicts. A partial one (Devpost stopped answering)
        # is short by an unknown amount: deleting the entries it failed to see would erase teams
        # from the field on a WAF's whim.
        if entries and complete:
            conn.execute(
                """DELETE FROM event_entries WHERE run_id = %s AND grade_id IS NULL
                     AND project_url <> ALL(%s);""",
                (run_id, [e.project_url for e in entries]),
            )
        conn.execute(
            """UPDATE event_runs
                  SET status = 'ready',
                      entries_found = %(n)s, gallery_complete = %(c)s,
                      detail = left(%(d)s, 2000), resolved_at = now(),
                      refresh_requested = false,
                      refresh_new_submissions = %(rn)s,
                      refresh_modified_submissions = %(rm)s
                WHERE id = %(id)s AND status = 'resolving';""",
            {"n": len(entries), "c": complete, "d": detail, "id": run_id,
             "rn": refresh_counts[0] if refresh_counts else None,
             "rm": refresh_counts[1] if refresh_counts else None},
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
         WHERE r.status IN ('grading', 'ready')
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
           AND NOT EXISTS (
                 SELECT 1 FROM event_runs r
                  WHERE r.id = grades.event_run_id AND r.status = 'cancelled')
           -- A regrade that happened mid-pass repointed the entry at a new grade; the superseded
           -- one holds no link any more, so its tail is recovered into a report nobody reads.
           -- Public grades have no entries and keep booking as always.
           AND (grades.event_run_id IS NULL
                OR EXISTS (SELECT 1 FROM event_entries e WHERE e.grade_id = grades.id))
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


def claim_retry(conn: psycopg.Connection, lock_s: float, max_passes: int) -> Retry | None:
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
                  -- Pause holds the pass like it holds the queue; cancel ends the story. Without
                  -- this, cancelling an active run would still fire its attack-tail re-checks at
                  -- the apps for up to two passes afterwards.
                  AND NOT EXISTS (
                        SELECT 1 FROM event_runs r2
                         WHERE r2.id = g2.event_run_id
                           AND (r2.paused OR r2.status = 'cancelled'))
                  AND (g2.event_run_id IS NULL
                       OR EXISTS (SELECT 1 FROM event_entries e WHERE e.grade_id = g2.id))
                  -- The ceiling, enforced where the traffic is decided. schedule_retry refuses to
                  -- BOOK past the maximum and the supervisor stops booking after a pass, but neither
                  -- survives a worker killed between this claim and that branch: the passes are
                  -- already spent, retry_due_at still holds the claim lock, and every lock expiry
                  -- would hand the same grade out again, for ever.
                  AND g2.retry_passes < %(max_passes)s
                ORDER BY g2.retry_due_at
                FOR UPDATE OF g2 SKIP LOCKED
                LIMIT 1
         )
     RETURNING g.id, g.origin, g.mode, g.retry_passes,
               (SELECT r2.blocked_probes FROM results r2 WHERE r2.grade_id = g.id) AS blocked;
        """,
        {"lock": lock_s, "max_passes": max_passes},
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
                  blocked_probes, incomplete_axes, percentile, percentile_band, curve_version, ranking,
                  bot_challenge, challenge_stage, retry_blocked_initial, challenge_onset_index
             FROM results WHERE grade_id = %s;""",
        (grade_id,),
    ).fetchone()
    return dict(row) if row else None
