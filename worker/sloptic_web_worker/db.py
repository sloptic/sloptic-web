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
                                 card, outcomes, axis_potential)
            VALUES (%(grade_id)s, %(mode)s, %(catalog_version)s, %(passive_probe_count)s, %(slop_score)s,
                    %(axis_slop)s, %(coverage)s, %(platform)s, %(surface)s, %(findings)s,
                    %(card)s, %(outcomes)s, %(axis_potential)s)
            ON CONFLICT (grade_id) DO UPDATE SET
                slop_score = EXCLUDED.slop_score, axis_slop = EXCLUDED.axis_slop,
                coverage = EXCLUDED.coverage, platform = EXCLUDED.platform,
                surface = EXCLUDED.surface, findings = EXCLUDED.findings,
                card = EXCLUDED.card, outcomes = EXCLUDED.outcomes,
                axis_potential = EXCLUDED.axis_potential;
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
