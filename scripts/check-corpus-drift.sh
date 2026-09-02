#!/usr/bin/env bash
# Are the vendored corpus figures still the ones the grader committed?
#
# Vercel cannot see sloptic-main, so web/lib/corpus/*.json are COPIES. A copy silently goes stale the
# moment the corpus is regraded, and stale figures on a public page are worse than none: the site
# would be quoting numbers the study no longer says. This compares byte for byte and tells you what
# to re-copy. Run it before publishing anything that cites the corpus.
#
# Source of truth: sloptic-main validation/corpus-figures-{active,passive}.json
set -u
MAIN="${SLOPTIC_MAIN:-$HOME/Documents/sloptic-main}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REF="${1:-}"          # optional git ref in sloptic-main; default is its working tree
status=0

for rel in validation/corpus-figures-active.json validation/corpus-figures-passive.json validation/grade-timing.json; do
  set="$(basename "$rel" .json)"
  vendored="$HERE/web/lib/corpus/$(basename "$rel")"
  if [ -n "$REF" ]; then
    source_json="$(git -C "$MAIN" show "$REF:$rel" 2>/dev/null)" || { echo "MISSING  $set: $REF:$rel"; status=1; continue; }
  else
    [ -f "$MAIN/$rel" ] || { echo "MISSING  $set: $MAIN/$rel"; status=1; continue; }
    source_json="$(cat "$MAIN/$rel")"
  fi

  if [ "$source_json" = "$(cat "$vendored")" ]; then
    stamp=$(printf '%s' "$source_json" | grep -o '"generated_at": *"[^"]*"' | head -1)
    echo "ok       $set  ($stamp)"
  else
    echo "DRIFTED  $set"
    echo "         vendored: $(grep -o '"generated_at": *"[^"]*"' "$vendored" | head -1)"
    echo "         source:   $(printf '%s' "$source_json" | grep -o '"generated_at": *"[^"]*"' | head -1)"
    echo "         fix: cp $MAIN/$rel $vendored"
    status=1
  fi
done
exit $status
