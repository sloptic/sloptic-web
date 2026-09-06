"""Outbound notification mail, sent from the worker because the worker is what knows the work
finished.

Deliberately NOT the path Supabase Auth uses. Sign-in mail goes through Supabase's own SMTP
settings; this is our code calling Resend directly, and the two share only a sending domain. Keeping
them apart means a bug here cannot stop anyone signing in, which is the difference between an
annoyance and a locked door.

Sends nothing at all when RESEND_API_KEY is unset, so a development worker and CI do not mail
strangers. That is a no-op rather than an error: an operator running the worker locally has not
misconfigured anything, they simply are not sending mail.
"""
from __future__ import annotations

import pathlib
import re

import httpx

from . import config

_TEMPLATES = pathlib.Path(
    config.EMAIL_TEMPLATE_DIR
    or (pathlib.Path(__file__).resolve().parents[2] / "web" / "emails")
)

# Resend's own timeout, kept short. A slow mail API must not hold the supervisor loop, and a mail
# that fails to send is retried on the next pass anyway, because the row stays unmarked.
_TIMEOUT = 10.0


class NotSent(Exception):
    """Sending failed. The caller leaves the row unmarked so the next pass tries again."""


def enabled() -> bool:
    return bool(config.RESEND_API_KEY and config.NOTIFY_FROM)


def render(template: str, **fields: str) -> str:
    """Fill {{ name }} placeholders. Values are HTML-escaped, since an origin is user-supplied.

    A URL a stranger submitted reaches this mail, so `<script>` in a hostname must arrive as text.
    Nothing here needs to inject markup, so escaping everything is the safe default rather than a
    per-field decision someone gets wrong later.
    """
    html = (_TEMPLATES / template).read_text()
    for key, value in fields.items():
        safe = (str(value).replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))
        html = html.replace("{{ " + key + " }}", safe)
    left = re.findall(r"\{\{\s*([a-z_]+)\s*\}\}", html)
    if left:
        raise NotSent(f"{template} has unfilled placeholders: {sorted(set(left))}")
    return html


def send(to: str, subject: str, html: str) -> None:
    """One message. Raises NotSent on anything that is not a success.

    Carries List-Unsubscribe, so Gmail and the rest show their own unsubscribe control beside the
    sender. That matters more than politeness here: someone mildly tired of these will otherwise
    press "spam", which costs the send AND the sending reputation that every later message depends
    on. A mailto rather than a one-click URL, because one-click (RFC 8058) needs an endpoint that
    unsubscribes without a session, which needs a signed token, which is a lot of machinery for a
    volume this small. The account toggle remains the real control; this is the exit for people who
    will not go looking for it.
    """
    if not enabled():
        raise NotSent("no RESEND_API_KEY; notification mail is off")
    try:
        r = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            json={
                "from": config.NOTIFY_FROM,
                "to": [to],
                "subject": subject,
                "html": html,
                "headers": {
                    "List-Unsubscribe": f"<mailto:{config.UNSUBSCRIBE_MAILBOX}?subject=unsubscribe>",
                },
            },
            timeout=_TIMEOUT,
        )
    except Exception as e:  # noqa: BLE001 - transport of any kind means "not sent"
        raise NotSent(f"{type(e).__name__}: {e}") from e
    if r.status_code >= 300:
        # The body carries Resend's reason (a daily cap, an unverified domain, a bad address), and
        # that reason is the whole value of the log line when mail silently stops arriving.
        raise NotSent(f"HTTP {r.status_code}: {r.text[:300]}")
