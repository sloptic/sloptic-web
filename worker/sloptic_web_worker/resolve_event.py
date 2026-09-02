"""Work out what an event run would actually grade, before anything is graded.

Pulls the event's gallery, takes each team's own published app URL, and screens out what must not be
probed. Runs in the worker for the same reasons verification does: the egress sandbox lives here, and
Devpost's WAF answers a residential connection.

The screen is not about doubting teams. A link a team published is a link they published, and they
are responsible for it. There is one boundary they cannot extend past: a submission pointing at a
vendor's product rather than something the team built. Probing a hosted notebook or a design tool
hits that company, not the team, and no team can consent on their behalf. Both pieces already exist
in the grader (`scope.off_target`), so this asks rather than re-deciding.
"""

from __future__ import annotations

from dataclasses import dataclass

from sloptic import devpost, platform_id, scope

from . import config


@dataclass
class Entry:
    project_url: str
    app_url: str | None
    skip_reason: str | None


@dataclass
class Field:
    entries: list[Entry]
    #: False when the gallery raised Blocked partway. The list is then SHORT BY AN UNKNOWN AMOUNT and
    #: must never be shown as the field: an organizer ranking 40 of 60 without being told is worse
    #: than no board.
    complete: bool
    detail: str


def _pick_app_url(hrefs: list[str]) -> tuple[str | None, str | None]:
    """The URL to grade from a submission's own links, or why none of them will do."""
    seen_offtarget: str | None = None
    for href in hrefs:
        if not href.lower().startswith(("http://", "https://")):
            continue
        denied = scope.off_target(href)
        if denied:
            seen_offtarget = seen_offtarget or denied
            continue
        plat = platform_id._platform_by_suffix(platform_id._host_of(href))
        if plat in config.CANVAS_SHELL_PLATFORMS:
            return None, (f"hosted on {plat}, where Sloptic cannot properly separate what the team "
                          f"built from the platform")
        return href, None
    if seen_offtarget:
        # Rendered in the field table, so it follows the site's voice: state it and stop.
        return None, f"points at {seen_offtarget}, someone else's product"
    return None, "no live app link on the submission"


def resolve(slug: str, limit: int = 1000) -> Field:
    entries: list[Entry] = []
    complete = True
    detail = "gallery read in full"
    try:
        for project_url, hrefs in devpost.submissions(slug):
            app_url, why = _pick_app_url(list(hrefs))
            entries.append(Entry(project_url, app_url, why))
            if len(entries) >= limit:
                complete = False
                detail = f"stopped at {limit} entries"
                break
    except devpost.Blocked as e:
        # Caught rather than allowed to end the loop quietly, which is the whole reason it is an
        # exception: what we have is a partial gallery, and saying so is the point.
        complete = False
        detail = f"Devpost stopped answering partway: {e}"
    except Exception as e:  # noqa: BLE001
        complete = False
        detail = f"worker error: {type(e).__name__}: {e}"
    return Field(entries, complete, detail)
