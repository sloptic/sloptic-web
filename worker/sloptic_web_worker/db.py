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
           AND submitted_at < now() - make_interval(secs => %(timeout)s)
     RETURNING 1;
        """,
        {"timeout": config.QUEUE_TIMEOUT_SECONDS},
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


def grades_in_last_day(conn: psycopg.Connection) -> int:
    """Grades this worker actually completed in a rolling 24h. Counted in the DB rather than in
    memory so a restart cannot reset the budget."""
    row = conn.execute(
        """
        SELECT count(*) AS n FROM grades
         WHERE finished_at > now() - interval '24 hours'
           AND status IN ('done', 'failed');
        """
    ).fetchone()
    return int(row["n"]) if row else 0


def claim_job(conn: psycopg.Connection) -> Job | None:
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
                ORDER BY submitted_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
         )
     RETURNING id, origin, submitted_url, mode;
        """
    ).fetchone()
    if not row:
        return None
    return Job(id=str(row["id"]), origin=row["origin"], submitted_url=row["submitted_url"], mode=row["mode"])


def save_result(conn: psycopg.Connection, job_id: str, result: dict) -> None:
    """Persist a finished grade and flip the job to done, in one transaction."""
    with conn.transaction():
        conn.execute(
            """
            INSERT INTO results (grade_id, mode, catalog_version, passive_probe_count, slop_score,
                                 axis_slop, coverage, platform, surface, findings,
                                 card, outcomes, axis_potential,
                                 percentile, percentile_band, curve_version, ranking)
            VALUES (%(grade_id)s, %(mode)s, %(catalog_version)s, %(passive_probe_count)s, %(slop_score)s,
                    %(axis_slop)s, %(coverage)s, %(platform)s, %(surface)s, %(findings)s,
                    %(card)s, %(outcomes)s, %(axis_potential)s,
                    %(percentile)s, %(percentile_band)s, %(curve_version)s, %(ranking)s)
            ON CONFLICT (grade_id) DO UPDATE SET
                slop_score = EXCLUDED.slop_score, axis_slop = EXCLUDED.axis_slop,
                coverage = EXCLUDED.coverage, platform = EXCLUDED.platform,
                surface = EXCLUDED.surface, findings = EXCLUDED.findings,
                card = EXCLUDED.card, outcomes = EXCLUDED.outcomes,
                axis_potential = EXCLUDED.axis_potential,
                percentile = EXCLUDED.percentile, percentile_band = EXCLUDED.percentile_band,
                curve_version = EXCLUDED.curve_version, ranking = EXCLUDED.ranking;
            """,
            {
                "grade_id": job_id,
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
