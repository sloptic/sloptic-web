#!/usr/bin/env bash
# Is everything vendored from the grader still what the pinned release committed?
#
# Two sets of files in this repo are COPIES of sloptic-main, because the places that use them cannot
# see it: Vercel builds the site without the grader's repo, and the wheel ships neither the curves
# (validation/) nor the ranker that reads them (scripts/benchmark.py).
#
#   web/lib/corpus/*.json   the corpus figures the findings page quotes
#   worker/curves/*         both frozen curves, and the benchmark.py released alongside them
#
# A copy silently goes stale the moment the grader moves. Stale figures on a public page quote numbers
# the study no longer says; a stale curve, or a ranker from a different release than its curve,
# misranks every grade without raising anything. This compares byte for byte and says what to re-copy.
#
# By default it compares against the TAG matching the grader pinned in worker/pyproject.toml, because
# that is the release the worker actually runs. Pass a ref to compare against something else, or
# `--worktree` to compare against sloptic-main as it sits on disk.
set -u
MAIN="${SLOPTIC_MAIN:-$HOME/Documents/sloptic-main}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

PIN="$(grep -oE '"sloptic==[0-9][^"]*"' "$HERE/worker/pyproject.toml" | head -1 | sed -E 's/"sloptic==(.*)"/\1/')"
REF="${1:-v$PIN}"
[ "$REF" = "--worktree" ] && REF=""
echo "comparing against ${REF:-the sloptic-main working tree} (worker pins sloptic==$PIN)"
status=0

check() {  # check <path in sloptic-main> <vendored path>
  local rel="$1" vendored="$2" source_body
  if [ -n "$REF" ]; then
    source_body="$(git -C "$MAIN" show "$REF:$rel" 2>/dev/null)" \
      || { echo "MISSING  $rel at $REF"; status=1; return; }
  else
    [ -f "$MAIN/$rel" ] || { echo "MISSING  $MAIN/$rel"; status=1; return; }
    source_body="$(cat "$MAIN/$rel")"
  fi
  if [ "$source_body" = "$(cat "$vendored" 2>/dev/null)" ]; then
    echo "ok       $rel"
  else
    echo "DRIFTED  $rel"
    echo "         fix: git -C $MAIN show ${REF:-HEAD}:$rel > $vendored"
    status=1
  fi
}

for f in corpus-figures-active.json corpus-figures-passive.json grade-timing.json; do
  check "validation/$f" "$HERE/web/lib/corpus/$f"
done
# The findings page's exploitable-class chart. Not in the figures JSON, so vendored from the chart data.
check docs/charts/fig07_exploitable.csv       "$HERE/web/lib/corpus/fig07_exploitable.csv"
check validation/benchmark-curve.json         "$HERE/worker/curves/benchmark-curve.json"
check validation/benchmark-curve-passive.json "$HERE/worker/curves/benchmark-curve-passive.json"
check scripts/benchmark.py                    "$HERE/worker/curves/benchmark.py"
exit $status
