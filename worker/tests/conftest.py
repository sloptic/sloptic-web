"""Test harness for the worker's database layer.

Against a REAL Postgres, deliberately. The worker's logic is its SQL: FOR UPDATE SKIP LOCKED, the
lane ordering in claim_job, the partial unique index behind one-live-run, the guards that make a
pause outrank a claim. A fake connection would assert none of that, and every bug this suite exists
to catch has lived in exactly those semantics.

The schema is built from schema_prelude.sql plus the real migrations, in order, so a migration that
does not apply cleanly fails here rather than on a production database.

Point TEST_DATABASE_URL at a throwaway Postgres. Locally:

    docker run -d --name sloptic-test-db -e POSTGRES_PASSWORD=test -e POSTGRES_DB=sloptic_test \
      -p 55432:5432 postgres:16
    export TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/sloptic_test
"""
from __future__ import annotations

import os
import pathlib

import pytest

# BEFORE the worker is imported, and this is load bearing. config.py resolves DATABASE_URL at import
# time through load_dotenv, which finds the repo's .env and therefore the PRODUCTION pooler. A test
# that called db.connect() would then write to the live database. dotenv does not clobber a variable
# that is already set, so claiming it here means any connection a test opens by accident lands in
# the throwaway Postgres instead. The assertion below proves it actually took.
_TEST_URL = os.environ.get("TEST_DATABASE_URL")
if _TEST_URL:
    os.environ["DATABASE_URL"] = _TEST_URL

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
PRELUDE = pathlib.Path(__file__).parent / "schema_prelude.sql"

# Truncated between tests rather than rolled back: several tests need two connections at once (SKIP
# LOCKED only means anything across sessions), and a shared open transaction would deadlock them.
_TABLES = "grades, results, event_entries, event_runs, event_claims, grants, profiles, rate_limits, worker_status"


def _url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set: start a throwaway Postgres, see this file's docstring")
    return url


@pytest.fixture(scope="session")
def schema() -> str:
    url = _url()
    with psycopg.connect(url, autocommit=True) as c:
        # From clean, every session. The migrations are the real ones and several are not idempotent
        # (create policy, create constraint), which is correct for a forward-only history and means
        # they can only be applied to an empty database. Rebuilding also makes the run prove, every
        # time, that the whole history still applies in order.
        c.execute("DROP SCHEMA IF EXISTS public CASCADE")
        c.execute("DROP SCHEMA IF EXISTS auth CASCADE")
        c.execute("CREATE SCHEMA public")
        c.execute(PRELUDE.read_text())
        for path in MIGRATIONS:
            try:
                c.execute(path.read_text())
            except Exception as e:  # noqa: BLE001 - naming the file is the whole value here
                raise AssertionError(f"migration {path.name} did not apply: {e}") from e
    return url


@pytest.fixture()
def conn(schema: str):
    """A connection shaped exactly like the worker's own: autocommit, dict rows."""
    with psycopg.connect(schema, autocommit=True, row_factory=dict_row) as c:
        c.execute(f"TRUNCATE {_TABLES} RESTART IDENTITY CASCADE")
        c.execute("TRUNCATE auth.users CASCADE")
        yield c


@pytest.fixture()
def second(schema: str):
    """A SECOND connection, for the races. One session cannot skip its own locks."""
    with psycopg.connect(schema, autocommit=True, row_factory=dict_row) as c:
        yield c


@pytest.fixture()
def account(conn):
    """An owner id, since every run and most grades hang off one."""
    row = conn.execute(
        "INSERT INTO auth.users (email) VALUES ('organizer@example.com') RETURNING id"
    ).fetchone()
    return row["id"]


@pytest.fixture(scope="session", autouse=True)
def _never_the_production_database():
    """Fails the whole run rather than let a stray connection reach production.

    The environment claim above is only as good as its effect, and the cost of it silently not
    working is writing to the live queue from a test suite that truncates tables between cases.
    """
    # Skips first, so "no test database configured" reads as a skip rather than as a wall of errors
    # from a worker import that cannot resolve its own settings.
    url = _url()

    from sloptic_web_worker import config

    assert config.DATABASE_URL == url, (
        "the worker resolved a different DATABASE_URL than the test one: refusing to run"
    )
    assert "supabase" not in config.DATABASE_URL, (
        f"the worker is pointed at what looks like production: {config.DATABASE_URL.split('@')[-1]}"
    )
