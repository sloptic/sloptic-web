"""Owner verification: the two proofs that an account controls an origin.

Both are read here, on the worker, because both are outbound fetches and the egress sandbox lives
here (0029 says why at length). Each returns the same tri-state the Devpost path uses, and for the
same reason: 'blocked' means WE COULD NOT LOOK, which is not 'not_found'. Only an answer that
positively says "no such file" or "no such record" may ever be reported as absence, because the
alternative tells an owner their token is missing when their server simply would not answer us.

What the two factors prove, and why it must be two:

  file  https://<origin>/.well-known/sloptic-verification.txt   control of what is SERVED
  dns   TXT _sloptic.<host>                                     control of the ZONE

An attacker with an open upload path or a subdomain takeover can serve a file. Editing the zone
needs the registrar or the DNS provider. Two files at two paths would be one factor written twice.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from hmac import compare_digest
from urllib.parse import urlparse

import dns.exception
import dns.resolver
import httpx

from . import egress

WELL_KNOWN = "/.well-known/sloptic-verification.txt"
DNS_LABEL = "_sloptic"

# The token has to be world readable (it is served on a public path and published in public DNS), so
# its security is positional, not textual: the proof is that THIS token appeared on THAT origin and
# in THAT zone. It still has to be unguessable, or someone could pre-place a token for a domain they
# are about to be asked about.
TOKEN_BYTES = 32

# A token file is a line of text. Anything larger is not our file, and reading it would be an invitation
# to stream a response at us.
_MAX_TOKEN_BODY = 4096
_TIMEOUT = 10.0


def new_token() -> str:
    return "sloptic-" + secrets.token_urlsafe(TOKEN_BYTES)


@dataclass
class Factor:
    status: str          # ok | not_found | blocked
    detail: str = ""


@dataclass
class Outcome:
    file: Factor
    dns: Factor

    @property
    def verified(self) -> bool:
        return self.file.status == "ok" and self.dns.status == "ok"

    @property
    def detail(self) -> str:
        return "; ".join(d for d in (self.file.detail, self.dns.detail) if d)


def check_file(origin: str, token: str) -> Factor:
    """Fetch the well-known token file from the origin itself.

    Redirects are NOT followed. A redirect is the server telling us to read something else, and the
    whole question is what THIS origin serves: following one would let an open redirect on the target
    (or an attacker-controlled Location) satisfy a proof about somebody else's content.
    """
    url = origin.rstrip("/") + WELL_KNOWN
    host = urlparse(origin).hostname or ""
    try:
        egress.guard_target(origin, host)
    except egress.EgressNotReady:
        raise
    except ValueError as e:
        # Resolves somewhere internal. Not "no token": a refusal to look at all.
        return Factor("blocked", f"refused to fetch: {e}")

    try:
        with httpx.Client(follow_redirects=False, timeout=_TIMEOUT) as client:
            r = client.get(url, headers={"user-agent": "sloptic-verification/1.0"})
    except Exception as e:  # noqa: BLE001 - transport of any kind is "could not look"
        return Factor("blocked", f"{type(e).__name__}: {e}")

    if r.status_code in (404, 410):
        # The only two answers that mean the file is genuinely absent.
        return Factor("not_found", f"HTTP {r.status_code}")
    if r.status_code >= 300:
        return Factor("blocked", f"HTTP {r.status_code}")

    body = r.text[:_MAX_TOKEN_BODY].strip()
    if not body:
        return Factor("blocked", "empty body")
    # compare_digest, never a substring test: a page that merely CONTAINS the token (a comment, a
    # log viewer, an error page echoing the URL) is not the same as a file that IS the token.
    if compare_digest(body, token):
        return Factor("ok")
    return Factor("not_found", "a file is served there, but it is not this claim's token")


def check_dns(host: str, token: str) -> Factor:
    """Look for the token in a TXT record at _sloptic.<host>."""
    name = f"{DNS_LABEL}.{host}"
    try:
        answers = dns.resolver.resolve(name, "TXT", lifetime=_TIMEOUT)
    except dns.resolver.NXDOMAIN:
        return Factor("not_found", "no _sloptic record")
    except dns.resolver.NoAnswer:
        return Factor("not_found", "the name exists but carries no TXT record")
    except (dns.resolver.NoNameservers, dns.exception.Timeout) as e:
        # SERVFAIL or a timeout is the resolver failing, not the zone answering "no".
        return Factor("blocked", f"{type(e).__name__}: {e}")
    except Exception as e:  # noqa: BLE001
        return Factor("blocked", f"{type(e).__name__}: {e}")

    for rdata in answers:
        # A TXT record is a list of strings; providers split long values and quote them.
        value = "".join(part.decode() if isinstance(part, bytes) else str(part)
                        for part in rdata.strings).strip()
        if compare_digest(value, token):
            return Factor("ok")
    return Factor("not_found", "a TXT record is published, but it is not this claim's token")


def check(origin: str, host: str, token: str) -> Outcome:
    """Both factors. Neither short-circuits the other: an owner fixing one wants to see the other."""
    return Outcome(file=check_file(origin, token), dns=check_dns(host, token))
