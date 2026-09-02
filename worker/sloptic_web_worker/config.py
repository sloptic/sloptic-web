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

# Consecutive entry-challenged grades before the breaker trips. 25 is not a guess: it is
# `_IP_BLOCK_SAMPLE` from the grader's scripts/retry_blocked.py, which was RELAXED UP from 8 after
# observing that a real flag is INTERMITTENT (three late successes right after a nine-challenge
# cluster), so "a low bar aborts a run that would still recover". Only a long sustained dead streak
# is a hard flag. Any grade that reaches its app resets the streak. 0 disables the breaker.
CHALLENGE_TRIP_STREAK = int(os.environ.get("CHALLENGE_TRIP_STREAK", "25"))

# How long the worker stops claiming once that pattern is confirmed. An IP-level flag fades in
# roughly a day or two and every retry re-warms it, so the correct response is to stop and let it
# decay, not to dig (scripts/retry_blocked.py's circuit breaker makes the same call).
CHALLENGE_BACKOFF_SECONDS = float(os.environ.get("CHALLENGE_BACKOFF_SECONDS", str(48 * 3600)))

# A claimed job with no result after this long is presumed dead (the supervisor was killed
# mid-grade, taking the child with it before it could write a reason) and is returned to the queue.
#
# Derived from the deadline rather than guessed, and set below where GRADE_TIMEOUT_SECONDS is
# defined. Nothing can legitimately be running past its own deadline, since the supervisor kills it
# there, so anything still `running` well after that is a ghost row and waiting longer only leaves
# someone watching a page poll. The old fixed 1800s predated the deadline and made a service restart
# cost 30 minutes of false "grading".

# A queued grade nobody has started within this long is failed rather than left spinning. The read
# path uses the worker heartbeat, not this timer, to detect "nothing is running at all".
#
# 60 minutes, not the original 15. At 4 concurrent and 4-7 minutes a grade the worker clears roughly
# 35-50 an hour, so 15 minutes only ever covered a backlog of about 10: past that, a HEALTHY worker
# grinding through a real queue would fail everyone it had not reached yet, and the visitor would
# learn it after a quarter hour on a progress page. That is a launch-shaped failure, since a burst is
# exactly what publicity produces. The site now refuses at the door instead (MAX_QUEUE_DEPTH in
# web/lib/flags.ts, 30), so this window only has to outlast a full queue, which it does with room.
QUEUE_TIMEOUT_SECONDS = float(os.environ.get("QUEUE_TIMEOUT_SECONDS", "3600"))
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "3"))

# --- per-grade deadline and concurrency ---------------------------------------------------------
# A grade that exceeds this is killed. It is a HARD wall clock, enforced by the supervisor against a
# child process, because that is the only thing that stops the failure mode it exists for: a
# Playwright sync call on a CPU-spun renderer holds the GIL, so the child cannot time itself out and
# no signal it might handle will land (sloptic's own corpus runners reached the same conclusion, see
# scripts/run_batch.py). Counts from claim, so it includes any wait for the Lighthouse trace lane.
# 900s, matching the wall the corpus runs used, which is also what validation/grade-timing.json
# measured under: at any other wall the vendored distribution is not quite ours.
#
# 600 was costing more than it saved. On the full battery p95 is 573s and p99 is 832s, so a 600s wall
# kills something like 5% of grades that would have finished, and it kills them AFTER spending the
# full 600s, so the slot is burned either way and the grade is lost as well. Passive barely notices
# (p99 is 455s), but the wall has to suit the slower battery.
GRADE_TIMEOUT_SECONDS = float(os.environ.get("GRADE_TIMEOUT_SECONDS", "900"))

# How many grades may run at once. Each is its own process, so a wedge costs one slot rather than the
# worker.
MAX_CONCURRENT_GRADES = int(os.environ.get("MAX_CONCURRENT_GRADES", "4"))

# Deadline + slack for the supervisor to notice, kill and reap. Overridable, but the default should
# stay tied to the deadline.
STALE_JOB_SECONDS = float(os.environ.get("STALE_JOB_SECONDS", str(GRADE_TIMEOUT_SECONDS + 120)))

# Concurrent grades must not all trace at once: Lighthouse measures LCP/TBT on this box, so traces
# sharing a CPU measure each other's contention. sloptic throttles the lane with a counting semaphore
# over flock files (pipeline._lighthouse_lock), which works across processes, which is one of the two
# reasons grades are processes here.
#
# 3, NOT the grader's default of 1, because the number has to match the CURVE. passive-2026.1 was
# graded at 3 slots (that is what brought the corpus in at 35-40 hours instead of days), so 3 is the
# condition those percentiles describe. A quieter lane would not be "more accurate", it would be a
# different measurement from the one an app is being ranked against. Change this only by re-freezing
# the curve, never to tune throughput.
#
# NB: setting this in a shell rc does NOT reach the worker. systemd never sources a bashrc; the unit
# reads Environment= and EnvironmentFile=. It belongs in the repo-root .env.
LIGHTHOUSE_LOCK_PATH = os.environ.get("SLOPTIC_LIGHTHOUSE_LOCK", "/tmp/sloptic-lighthouse.lock")
LIGHTHOUSE_SLOTS = os.environ.get("SLOPTIC_LIGHTHOUSE_SLOTS", "3")


# --- reference curve (percentile for anonymous passive grades) ---------------------------------
# Empty until the passive-only corpus run produces one. A passive grade may ONLY rank on a curve
# tagged `probe_set: "passive"`; the grader's benchmark.rank refuses anything else, and
# ranking.load_curve refuses it a second time here. No curve simply means no percentile.
PASSIVE_CURVE_PATH = os.environ.get("PASSIVE_CURVE_PATH", "")
# Where the grader's scripts/ live, for benchmark.rank (it sits outside the importable package).
CURVE_SCRIPTS_DIR = os.environ.get("CURVE_SCRIPTS_DIR", "../sloptic-main/scripts")


# --- organizer event verification -----------------------------------------------------------------
# The origin an organizer's "Grading policy" link must point at. The token is read from the PATH of a
# link whose host is this, so a wrong value here fails every check closed rather than open.
SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "https://sloptic.org")

# How long an event grant lasts before it must be re-proven. Matches the owner tier: an event changes
# hands, an organizer moves on, and a grant nobody re-checks is a standing authorization nobody owns.
GRANT_DAYS = int(os.environ.get("GRANT_DAYS", "90"))

# How long a claim keeps waiting for its token to appear before it is failed. Generous: an organizer
# may verify days before they finish writing their rules page.
CLAIM_EXPIRY_DAYS = int(os.environ.get("CLAIM_EXPIRY_DAYS", "14"))


# Platforms whose apps are hosted INSIDE a framework's own shell, where a grade measures the shell as
# much as the team's work. Skipped in an event run for the same reason the corpus study excludes them
# from its per stack comparison: Sloptic cannot properly separate what the team built from the
# platform. On a chart that is a footnote; on a leaderboard it is an unfair row, because that team
# would be ranked on somebody else's page.
#
# Source of truth is by_stack_excluded in the corpus figures (currently streamlit, 82 apps). Named by
# PLATFORM rather than hostname, so sloptic.platform_id does the identifying and this stays a policy
# list rather than a second host matcher.
CANVAS_SHELL_PLATFORMS = {
    p.strip().lower()
    for p in os.environ.get("CANVAS_SHELL_PLATFORMS", "streamlit").split(",")
    if p.strip()
}


# An event grade waits behind its whole field and behind every public submission, so the queue window
# that suits one person's grade would fail the tail of any real event: 52 apps at 4 concurrent is
# over an hour, and those grades are not stranded, they are queued behind work in progress.
EVENT_QUEUE_TIMEOUT_SECONDS = float(os.environ.get("EVENT_QUEUE_TIMEOUT_SECONDS", str(12 * 3600)))


# Events grade from their own daily allowance, so a field cannot spend the one the public tier runs
# on. Sharing a single budget meant one 250 app event exhausted the day and the worker stopped
# claiming ANYTHING, so an organizer doing exactly what the product invites them to do took the site
# down for everyone until midnight.
#
# The two are separate ceilings, not a split of one: the box can do more than 300 grades a day, and
# 300 is a brake on runaway cost rather than a hardware limit.
DAILY_EVENT_BUDGET = int(os.environ.get("DAILY_EVENT_BUDGET", "500"))
