#!/usr/bin/env bash
#
# Take the grader down, and say why on the site while it is gone.
#
#   sudo ./maintenance.sh down "Down for the corpus re-run. Back next week."
#   sudo ./maintenance.sh up
#   ./maintenance.sh status          # no sudo needed, reads only
#
# WHY THIS EXISTS, rather than just `systemctl stop`:
#
# The site detects a missing worker on its own (the heartbeat goes stale after 90s and both the
# landing form and POST /api/grade close), so stopping the service is already enough to keep the
# queue from filling with grades nothing will run. What stopping alone cannot do is explain itself.
# A planned week reads exactly like a crash, and "Sloptic is not taking new grades right now" is a
# true sentence that makes a returning visitor assume the site is broken rather than busy.
#
# The note lives in worker_status.paused_note, in the database, because of who writes it: the person
# stopping the worker is on this box with a shell, not in a Vercel dashboard, and an env var would
# mean a redeploy to say a sentence and a second one to take it back. The heartbeat never touches
# that column, so the message outlives the process whose absence it explains.
#
# ORDER MATTERS in both directions and the script enforces it:
#   down: write the note, THEN stop, so the note is already in place when the door starts refusing.
#   up:   start, WAIT for a real heartbeat, THEN clear, so the message is not withdrawn before the
#         thing it describes is actually over.

set -euo pipefail

SERVICE="sloptic-worker"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"          # worker/deploy -> repo root
PY="$ROOT/worker/.venv/bin/python"
ENV_FILE="$ROOT/.env"
# The site calls a heartbeat older than 90s dead, so it must beat at least once inside this.
WAIT_FOR_BEAT=120

die() { echo "maintenance: $*" >&2; exit 1; }

[[ -x "$PY" ]]        || die "no worker venv at $PY"
[[ -r "$ENV_FILE" ]]  || die "no readable .env at $ENV_FILE (it holds DATABASE_URL)"

# Only DATABASE_URL, and never by sourcing: .env holds the service-role key and the LLM key too, and
# a stray backtick in any of them would run as this script under sudo.
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[[ -n "$DATABASE_URL" ]] || die "DATABASE_URL is not set in $ENV_FILE"
export DATABASE_URL

need_root() {
  [[ $EUID -eq 0 ]] || die "'$1' stops or starts a service, so it needs sudo. Try: sudo $0 $1${2:+ \"$2\"}"
}

# All database work goes through here. The note arrives as a QUERY PARAMETER, never interpolated:
# it is free text an operator types and it will contain apostrophes the first time someone writes
# "we're back Tuesday".
db() {
  "$PY" - "$@" <<'PYEOF'
import os, sys, psycopg
from psycopg.rows import dict_row

action = sys.argv[1]
with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row, autocommit=True) as conn:
    if action == "set-note":
        conn.execute(
            """
            INSERT INTO worker_status (id, paused_note) VALUES ('worker', %s)
            ON CONFLICT (id) DO UPDATE SET paused_note = EXCLUDED.paused_note
            """,
            (sys.argv[2],),
        )
        print("note set")
    elif action == "clear-note":
        conn.execute("UPDATE worker_status SET paused_note = NULL WHERE id = 'worker'")
        print("note cleared")
    elif action == "read":
        row = conn.execute(
            """
            SELECT state, paused_note,
                   extract(epoch from (now() - last_seen))::int AS age
              FROM worker_status WHERE id = 'worker'
            """
        ).fetchone()
        if not row:
            print("heartbeat none   (no worker has ever checked in)")
            sys.exit(0)
        alive = row["age"] is not None and row["age"] < 90
        print(f"heartbeat {row['age']}s ago, state={row['state']}, "
              f"site sees: {'UP' if alive else 'DOWN'}")
        print(f"note      {row['paused_note'] or '(none)'}")
    elif action == "beat-age":
        row = conn.execute(
            "SELECT extract(epoch from (now() - last_seen))::int AS age FROM worker_status WHERE id = 'worker'"
        ).fetchone()
        print(row["age"] if row and row["age"] is not None else 99999)
PYEOF
}

case "${1:-}" in
  down)
    need_root down "${2:-why, and roughly how long}"
    MESSAGE="${2:-}"
    [[ -n "$MESSAGE" ]] || die 'down needs a message: sudo '"$0"' down "why, and roughly how long"'
    echo "==> note"
    db set-note "$MESSAGE"
    echo "    \"$MESSAGE\""
    echo "==> stopping $SERVICE"
    systemctl stop "$SERVICE"
    echo
    echo "Grading closes on the site within 90s, when the heartbeat goes stale."
    echo "Anything already running was killed mid-grade and will be reaped as stale on the way back up."
    echo "Bring it back with: sudo $0 up"
    ;;

  up)
    need_root up
    echo "==> starting $SERVICE"
    systemctl start "$SERVICE"
    echo "==> waiting for a heartbeat (up to ${WAIT_FOR_BEAT}s)"
    # The note is only withdrawn once the worker has actually spoken. Starting the unit proves that
    # systemd launched a process, not that it reached the database, and clearing on the former would
    # leave the site closed with nothing to say during a start that failed.
    for _ in $(seq "$WAIT_FOR_BEAT"); do
      if [[ "$(db beat-age)" -lt 90 ]]; then
        echo "==> worker is checking in"
        db clear-note
        echo
        db read
        exit 0
      fi
      sleep 1
    done
    die "no heartbeat after ${WAIT_FOR_BEAT}s. The note is left in place on purpose, since grading is still down. Check: journalctl -u $SERVICE -n 50"
    ;;

  status|"")
    echo "==> systemd"
    systemctl is-active "$SERVICE" || true
    echo "==> database"
    db read
    ;;

  *)
    die "unknown command '${1}'. Use: down \"message\" | up | status"
    ;;
esac
