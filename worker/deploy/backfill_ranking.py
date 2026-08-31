#!/usr/bin/env python3
"""Backfill percentile (and the precise score) on grades stored before the curve existed.

Two repairs, both reading only what is already in the row:

  1. slop_score was an int column, so a 21.6 was written as 22. axis_slop is jsonb and kept its
     decimals, and the axes sum to the score by definition, so the precise value is recoverable.
     Run 0008_decimal_slop_score.sql FIRST or this writes the rounded number straight back.
  2. percentile was never computed, because ranking happens at grade time and these predate the
     curve. Nothing about ranking needs the grade re-run: it is a function of the stored record.

Idempotent, and skips any row it cannot place rather than guessing.

    ./worker/.venv/bin/python worker/deploy/backfill_ranking.py [--apply]
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sloptic_web_worker import db, ranking  # noqa: E402

APPLY = "--apply" in sys.argv


def main() -> int:
    curve = ranking.load_curve()
    if curve is None:
        print("no passive curve configured (PASSIVE_CURVE_PATH); nothing to do")
        return 1
    print(f"curve {curve.get('version')} ({curve.get('status')}), n={curve['overall']['n']}\n")

    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.grade_id, r.slop_score, r.axis_slop, r.coverage, r.findings, r.percentile,
                   g.submitted_url
              FROM results r JOIN grades g ON g.id = r.grade_id
             ORDER BY g.submitted_at
            """
        )
        rows = cur.fetchall()

        for row in rows:
            gid = str(row["grade_id"])
            axes = row["axis_slop"] or {}
            # The axes are the surviving copy of the precision the int column destroyed.
            exact = round(sum(float(v) for v in axes.values()), 1) if axes else None
            stored = float(row["slop_score"])
            score = exact if exact is not None else stored

            rec = {
                "repo": row["submitted_url"],
                "deployed": True,
                "slop_score": score,
                "axis_slop": axes,
                "coverage": row["coverage"] or {},
                "findings": row["findings"] or [],
            }
            rank = ranking.rank_passive(rec, score)

            note = []
            if exact is not None and abs(exact - stored) > 1e-9:
                note.append(f"score {stored:g} -> {exact:g}")
            note.append(f"p{rank['percentile']} {rank['band']}" if rank else "not rankable")
            print(f"  {gid[:8]} {row['submitted_url'][:38]:38s} {', '.join(note)}")

            if APPLY:
                cur.execute(
                    """
                    UPDATE results
                       SET slop_score = %(score)s,
                           percentile = %(pct)s,
                           percentile_band = %(band)s,
                           curve_version = %(curve)s,
                           ranking = %(rank)s
                     WHERE grade_id = %(id)s
                    """,
                    {
                        "id": gid,
                        "score": score,
                        "pct": (rank or {}).get("percentile"),
                        "band": (rank or {}).get("band"),
                        "curve": curve.get("version") if rank else None,
                        "rank": json.dumps(rank) if rank else None,
                    },
                )

    print(f"\n{len(rows)} row(s) {'updated' if APPLY else 'inspected (dry run; pass --apply)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
