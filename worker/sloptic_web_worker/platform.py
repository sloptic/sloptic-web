"""Platform hosts, read from the list the web half also reads.

CLAUDE.md makes the platform floor STRUCTURAL: someone on team.vercel.app cannot publish
_sloptic.team.vercel.app because the zone is not theirs, so the second factor is unavailable by
construction and no amount of good faith produces it.

The API refuses these when a claim is created, which is where a person is told why. This module is
the same refusal at grade time, and it is not redundant: a grant can predate a suffix being added to
the list, or be written by hand, and may_grade_actively is the last place anyone asks whether attack
traffic may be sent at an app.
"""
from __future__ import annotations

import json
import pathlib

_LIST = pathlib.Path(__file__).resolve().parents[2] / "shared" / "platform-suffixes.json"


def _load() -> tuple[str, ...]:
    try:
        return tuple(json.loads(_LIST.read_text())["suffixes"])
    except Exception:  # noqa: BLE001
        # Fails CLOSED on the entries that matter most. A missing or unreadable list must not turn
        # into "no host is a platform host", which would be the permissive reading of a broken file.
        return ("vercel.app", "netlify.app", "github.io", "pages.dev", "workers.dev",
                "herokuapp.com", "onrender.com", "fly.dev", "web.app", "firebaseapp.com")


SUFFIXES = _load()


def platform_suffix(host: str) -> str | None:
    """The platform suffix this host sits under, or None when it looks like its own domain."""
    h = (host or "").lower().rstrip(".")
    for suffix in SUFFIXES:
        if h == suffix or h.endswith("." + suffix):
            return suffix
    return None
