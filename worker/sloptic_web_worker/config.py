"""Worker configuration, read from the environment.

In dev, values come from the monorepo ROOT .env (one file for both packages). A worker/.env, if present,
takes precedence for local overrides. In production, real environment variables win over both.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# config.py -> sloptic_web_worker -> worker -> repo root
_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / "worker" / ".env")   # optional local override, loaded first (dotenv won't clobber)
load_dotenv(_ROOT / ".env")              # the shared root .env


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise SystemExit(f"missing required env var: {name}")
    return val


DATABASE_URL = _require("DATABASE_URL")
CATALOG_DIR = os.environ.get("CATALOG_DIR", "../../sloptic-main/catalog")
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "5"))

# P0 safety gate: refuses real grading unless the egress sandbox is deployed AND its self-test
# (worker/deploy/selftest.py) passes on this host.
EGRESS_SANDBOX_READY = os.environ.get("EGRESS_SANDBOX_READY", "").strip() in ("1", "true", "yes")

# --- IP-reputation controls -------------------------------------------------------------------
# The worker grades from a residential IP on purpose (a datacenter IP gets challenged by Vercel's
# WAF, which would make most of the population ungradeable and the measurement incomparable to the
# frozen curve). That IP is therefore a shared, slow-to-recover asset, and these two knobs protect
# it. Neither is part of the egress sandbox: they limit HOW MUCH we grade, not WHERE we may connect.

# Grades completed in a rolling 24h before the worker stops claiming. Measured headroom is roughly
# 8-10k grades before Vercel flags the IP, so this is a circuit against pathology (a runaway batch,
# an abusive submitter), not a ration for normal use.
DAILY_GRADE_BUDGET = int(os.environ.get("DAILY_GRADE_BUDGET", "300"))

# How many DISTINCT origins must entry-challenge in a row before the breaker trips. An IP-level
# flag is defined by re-challenging EVERY app at entry, so one app doing it proves nothing except
# that that app has an aggressive WAF. Any grade that completes normally clears the streak.
CHALLENGE_TRIP_STREAK = int(os.environ.get("CHALLENGE_TRIP_STREAK", "3"))

# How long the worker stops claiming once that pattern is confirmed. An IP-level flag fades in
# roughly a day or two and every retry re-warms it, so the correct response is to stop and let it
# decay, not to dig (scripts/retry_blocked.py's circuit breaker makes the same call).
CHALLENGE_BACKOFF_SECONDS = float(os.environ.get("CHALLENGE_BACKOFF_SECONDS", str(48 * 3600)))

# A claimed job with no result after this long is presumed dead (the worker was killed mid-grade)
# and is returned to the queue. Generous: a real grade with three Lighthouse runs takes ~7 minutes.
STALE_JOB_SECONDS = float(os.environ.get("STALE_JOB_SECONDS", "1800"))
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "3"))
