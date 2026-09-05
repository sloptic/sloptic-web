"""Settle one organizer event claim: did they publish our token on the event's own Devpost pages?

Runs in the WORKER, not in a route handler, for the two reasons this whole project is shaped around:
every outbound fetch goes through the egress sandbox, which lives here, and the worker is on a
residential connection because a datacenter IP gets challenged by exactly the kind of WAF Devpost
runs. A check that cannot tell a block from an absence is worse than no check at all.

All Devpost access goes through `sloptic.devpost`. Nothing here builds a devpost.com URL, matches a
host, or decides what counts as absence; that module owns those and has the empirical work behind it.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from urllib.parse import urlparse

from sloptic import devpost

from . import config


@dataclass
class Window:
    """Whether the submission window was still running, and the raw state behind that call.

    `open` is None when we could not tell. The notice renders that as uncertainty, never as either
    answer: telling participants they face active checks when they might not, or the reverse, are
    both worse than saying we are not sure.
    """
    open: bool | None
    state: dict


def priority_of(state: dict) -> int:
    """Scheduling urgency from an event's own state. 0 sooner, 2 later.

    Devpost publishes no award announcement time, so this reads the two facts it does publish. An
    event whose submissions have closed but whose winners are not announced is being judged right
    now, which is the only moment a board actually has to arrive by.
    """
    if state.get("winners_announced"):
        return 2
    if state.get("open_state") == "ended":
        return 0
    return 1


def window_state(slug: str) -> Window:
    """Ask Devpost whether this event is still taking submissions.

    Gated on `open_state` and `winners_announced`, NOT on `submission_period_dates`, which the grader
    documents as display text carrying no timezone. Parsing a date string to decide whether attack
    traffic is authorized would be a guess dressed as a rule.
    """
    try:
        meta = devpost.event_meta(slug)
    except Exception as e:  # noqa: BLE001
        return Window(None, {"error": f"{type(e).__name__}: {e}"})
    if meta.status != "ok" or not meta.event:
        return Window(None, {"status": meta.status, "detail": meta.detail[:500]})
    ev = meta.event
    state = {k: ev.get(k) for k in ("open_state", "winners_announced", "invite_only",
                                    "submission_period_dates", "submission_gallery_url")}
    open_now = ev.get("open_state") == "open" and not ev.get("winners_announced")
    return Window(bool(open_now), state)


@dataclass
class Outcome:
    """What one check settled, in the vocabulary the row stores."""
    check_status: str          # ok | not_found | blocked, straight from devpost
    detail: str
    verified: bool
    # Why we are not verified yet, in words an organizer can act on. None when verified.
    message: str | None = None
    # Where our link was found (the event page's name) and the display text the organizer gave it,
    # set on a match so the verified slip can show the organizer their own link back to them.
    page: str = ""
    link_text: str = ""


def _token_from_href(href: str, site_host: str) -> str | None:
    """The token in a `https://<site>/e/<token>` link, or None if this href is not one of ours.

    Deliberately strict and deliberately positional. We take the token from the PATH of a link whose
    host is ours, never from anywhere in the page's text: a token quoted in a discussion thread, a
    screenshot caption, or a participant's comment must not verify anybody. `sloptic.devpost` hands us
    hrefs only, for the same reason.
    """
    try:
        u = urlparse(href.strip())
    except ValueError:
        return None
    if u.scheme not in ("http", "https"):
        return None
    if (u.hostname or "").lower() != site_host:
        return None
    parts = [p for p in u.path.split("/") if p]
    if len(parts) != 2 or parts[0] != "e":
        return None
    return parts[1]


def check(slug: str, token: str) -> Outcome:
    """Look for `token` among the links the event published on its own pages.

    The three-way reading is the point, and it comes from devpost.Links:
      * a match PROVES publication whatever the status, since every href came off the pinned host;
      * no match proves absence ONLY when the status is "ok", meaning every page was read;
      * "blocked" means at least one page could not be read, so the honest answer is "could not
        check", never "not verified".
    """
    site_host = (urlparse(config.SITE_ORIGIN).hostname or "").lower()
    try:
        found = devpost.event_links(slug)
    except Exception as e:  # noqa: BLE001 - an unexpected failure is still "could not check"
        return Outcome("blocked", f"{type(e).__name__}: {e}", False,
                       "Could not reach Devpost to check. We will try again shortly.")

    for link in found.links:
        got = _token_from_href(link.href, site_host)
        # compare_digest even though the token is public: it costs nothing and keeps the habit
        # correct for the next comparison, which may not be.
        if got is not None and hmac.compare_digest(got, token):
            return Outcome(found.status, f"matched on the {link.page} page; {found.detail}", True,
                           page=link.page, link_text=link.text)

    if found.status == "blocked":
        return Outcome("blocked", found.detail, False,
                       "Devpost did not answer us, so we could not check. We will try again shortly.")
    if found.status == "not_found":
        return Outcome("not_found", found.detail, False,
                       f"No pages found at {devpost.pinned_host(slug)}. Check the event address.")
    return Outcome("ok", found.detail, False,
                   "We read the event's pages and the grading policy link was not on them yet.")
