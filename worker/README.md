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


## The LAN resolver mangles NXDOMAIN (2026-09-05)

The box forwards DNS to 10.0.0.1, and that router answers **FORMERR** for every name that does not
exist, where a correct resolver answers NXDOMAIN. Names that DO exist answer NOERROR normally.

    1.1.1.1   nonexistent-xyz.google.com  ->  NXDOMAIN   correct
    10.0.0.1  nonexistent-xyz.google.com  ->  FORMERR    the router
    10.0.0.1  _dmarc.google.com     TXT   ->  NOERROR    fine, because that name exists

It is not about TXT, underscore labels, EDNS, UDP framing, or which stub is asked: `nonexistent`
anything gets FORMERR, and every rung of verify_domain's escalation gets the same answer, because
FORMERR is what the router SENDS rather than a failure to reach it.

What it costs. FORMERR is not an answer about the domain, so verify_domain reports the DNS factor as
`blocked` ("could not check"), which is correct and deliberate: reporting it as `not_found` would tell
an owner their record is missing when we never got a verdict. So a claim reads "could not check"
until the record is published. It does NOT block verification, because the moment the record exists
the name exists and the router answers properly.

The fix is on the box, not in the code. Point systemd-resolved somewhere that answers correctly:

    # /etc/systemd/resolved.conf
    [Resolve]
    DNS=1.1.1.1 8.8.8.8
    Domains=~.

    sudo systemctl restart systemd-resolved
    python3 worker/deploy/dns_probe2.py     # expect NXDOMAIN, not FORMERR

That fixes DNS for the whole box rather than working around it in one module, and it needs no
egress change: systemd-resolved's own upstream traffic runs under its uid, not the worker's, so the
uid-scoped rules in egress.nft never see it.

Diagnosing it again: `worker/deploy/dns_probe.py` walks the resolvers through three ways of asking,
and `dns_probe2.py` prints the actual response CODES, which is what finally settled this. Exceptions
collapse FORMERR, SERVFAIL, REFUSED and a timeout into one word; the rcode does not.

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
