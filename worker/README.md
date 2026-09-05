## Deploying to the worker box

A pull and a restart is NOT always enough. `git pull && systemctl restart` is right only when
nothing in `pyproject.toml` changed; when a dependency was added, that sequence starts a worker whose
code imports something its environment does not have, and systemd then crash-loops it. That has
happened once (dnspython, for owner verification), so the safe sequence is:

    cd ~/sloptic-web && git pull
    cd worker && uv pip install -e .          # picks up dependency changes; no-op when there are none
    sudo systemctl restart sloptic-worker
    systemctl status sloptic-worker           # confirm it stayed up, not just that it started

The venv here is created by **uv**, which does not put a `pip` binary in it: `.venv/bin/pip` does not
exist and never did, so reach for `uv pip install` rather than the venv's own pip. `.venv/bin/python`
is what the systemd unit runs, and it is the interpreter any install has to land in. A global
`pip install --break-system-packages` does NOT reach it unless the venv was created with
`--system-site-packages`; check with:

    ~/sloptic-web/worker/.venv/bin/python -c "import dns.resolver; print('ok')"

If there is no uv on the box, the venv can be given a pip of its own:

    ~/sloptic-web/worker/.venv/bin/python -m ensurepip --upgrade
    ~/sloptic-web/worker/.venv/bin/python -m pip install -e ~/sloptic-web/worker

Reading the exit code is worth a moment when it does fail. `status=1/FAILURE` means the interpreter
ran and the program raised, which is usually a missing import or a missing environment variable;
`status=203/EXEC` means systemd could not run the interpreter at all, which is a path or permission
problem in the unit file. They point at completely different things.

Migrations are applied separately and BEFORE the restart, since the new code generally expects the
new schema:

    psql "$DATABASE_URL" -f supabase/migrations/00NN_whatever.sql


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
