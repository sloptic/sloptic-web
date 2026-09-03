"""One WAF-recovery pass, in a child process.

A subprocess rather than inline, for two reasons. A padded pass is near a full battery in length, and
a wedge in the worker's main loop is a wedge in everything; and the injection fan-out must run SERIAL
on a retry, which the grader reads from the environment ONCE at import (sloptic/probes.py), so the
parent sets SLOPTIC_INJECT_POOL / SLOPTIC_EXPOSURE_POOL for this process alone while the main grade
keeps the parallel default its diluted battery survives.

Grades only: no DB access. The parent owns claiming, merging, and persistence, and a child that
cannot touch the queue cannot corrupt it. On success the result JSON goes to the file named in argv;
stdout stays quiet so the parent's capture of it means something.
"""
import json
import sys

from sloptic_web_worker import grader


def main() -> int:
    origin, mode, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    only_probes = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else None
    try:
        if mode == "active":
            result = grader.run_active_grade(origin, only_probes=only_probes)
        else:
            result = grader.run_passive_grade(origin)
    except Exception as e:  # noqa: BLE001
        print(f"retry grade failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    with open(out_path, "w") as f:
        json.dump(result, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
