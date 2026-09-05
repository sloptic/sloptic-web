
## Tests

Against a real Postgres, because the worker's logic is its SQL: the lane ordering in `claim_job`,
`FOR UPDATE SKIP LOCKED`, the guards that make a pause outrank a claim, the partial unique index
behind one live run per event. A fake connection would assert none of that, and those semantics are
where this worker's bugs have actually lived.

    docker run -d --name sloptic-test-db -e POSTGRES_PASSWORD=test -e POSTGRES_DB=sloptic_test \
      -p 55432:5432 postgres:16
    export TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/sloptic_test
    cd worker && PYTHONPATH=. python -m pytest tests/

The schema is rebuilt each session from `tests/schema_prelude.sql` plus the real migrations in
order, so a migration that no longer applies cleanly fails here rather than on a live database.

`conftest.py` claims `DATABASE_URL` before the worker is imported. Without that, `config.py` resolves
it through the repo `.env` to the PRODUCTION pooler, and a stray `db.connect()` in a test would
write to the live queue. A session fixture asserts the claim took, and the run refuses to start if
the worker is pointed anywhere that looks like production.

Without `TEST_DATABASE_URL` the suite skips rather than fails, so it stays out of the way when you
are working on something else.
