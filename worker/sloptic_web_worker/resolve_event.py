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

import pathlib

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
    """The URL to grade from a submission's own links, or why none of them will do.

    The reason is a few words because it is rendered once per row in a table an organizer scans down
    a field with. The link itself is on the row, so the reason does not repeat it.
    """
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
            return None, f"{plat} shell"
        return href, None
    if seen_offtarget:
        return None, "github only" if seen_offtarget == "github.com" else "third party link"
    return None, "no links provided"


class _FieldCache(devpost.IngestCache):
    """Persist each submission's own links across runs, but never the gallery enumeration.

    A submission's app links do not change once published, so re-fetching all of them on every
    regrade is the waste an organizer sees as "Reading the gallery" all over again. The gallery
    PAGES are the opposite: a run started later must still discover a team that submitted in
    between, so `page:` keys are neither read nor written and the listing is always fetched fresh.

    The ordinary path's cost is that an EDITED submission keeps its stale cached links for ever.
    A REFRESH (an organizer pressing the button because they expect the field to have changed) is
    the one moment staleness matters, so it flips every link key to a miss: each submission is
    fetched again and the cache ends the pass holding what is true now. What changed is counted by
    the CALLER against the run's own prior field rows, which is the comparison an organizer means,
    and one a cold cache cannot lie about.
    """

    def __init__(self, path, refresh: bool = False):
        super().__init__(path)
        self.refresh = refresh

    def has(self, key):
        k = str(key)
        if k.startswith("page:"):
            return False
        if self.refresh and (k.startswith("hrefs:") or k.startswith("links:")):
            return False                    # a refresh re-asks, even for submissions we know
        return super().has(key)

    def put(self, key, val):
        if not str(key).startswith("page:"):
            super().put(key, val)


def resolve(slug: str, limit: int = 1000, on_progress=None, refresh: bool = False) -> Field:
    """`on_progress(n)` is called as entries accumulate.

    A count, never a percentage: Devpost's gallery does not say how many submissions an event has
    before you have paged through them, so a progress bar would be drawing a total we invented.
    """
    entries: list[Entry] = []
    complete = True
    detail = "gallery read in full"
    # The cache turns a regrade's resolve from "re-fetch every submission" into "list the gallery,
    # fetch only the submissions we have not seen". Optional: a cache that cannot be opened must
    # never stop a resolve, so fall back to no cache.
    try:
        cache = _FieldCache(pathlib.Path(config.DEVPOST_CACHE_DIR) / f"{slug}.jsonl", refresh=refresh)
    except Exception:  # noqa: BLE001
        cache = None
    try:
        for project_url, hrefs in devpost.submissions(slug, cache=cache):
            app_url, why = _pick_app_url(list(hrefs))
            entries.append(Entry(project_url, app_url, why))
            if on_progress is not None and len(entries) % 10 == 0:
                on_progress(len(entries))
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
