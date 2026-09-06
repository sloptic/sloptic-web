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
import time
from dataclasses import dataclass
from hmac import compare_digest
from urllib.parse import urlparse

import httpx

from . import config, egress

WELL_KNOWN = "/.well-known/sloptic-verification.txt"
DNS_LABEL = "_sloptic"

# The token has to be world readable (it is served on a public path and published in public DNS), so
# its security is positional, not textual: the proof is that THIS token appeared on THAT origin and
# in THAT zone. It still has to be unguessable, or someone could pre-place a token for a domain they
# are about to be asked about.
TOKEN_BYTES = 32

# A token file is a line of text. Anything larger is not our file, and reading it would be an invitation
# to stream a response at us. Enforced WHILE READING (see check_file): capping r.text after the fact
# caps nothing, because by then the whole body is already in memory.
_MAX_TOKEN_BODY = 4096
_TIMEOUT = 10.0
# httpx timeouts are per OPERATION: the read timeout restarts on every chunk that arrives, so a
# server dribbling one byte every nine seconds is never "slow" by that measure and the fetch hangs
# for ever. This is the wall-clock ceiling on the whole exchange. It matters more than it looks:
# check_file runs inline in the supervisor loop, so a fetch that never returns stops grading,
# claiming and cancelling too, while the heartbeat thread keeps reporting the last state it cached.
_TOTAL_DEADLINE = 20.0


def _token_eq(seen: str, token: str) -> bool:
    """compare_digest, but it cannot raise on what a stranger serves us.

    compare_digest refuses str arguments containing non-ASCII ("comparing strings with non-ASCII
    characters is not supported"), and a catch-all 200 that renders "Pagina no encontrada" is an
    ordinary thing for an app to do. Uncaught, that TypeError left the claim recorded as blocked for
    ever: the owner is told "we could not check, we will try again" on a page we will never manage to
    check, and the stale-claim sweep never reaches it either. Our tokens are ASCII by construction,
    so anything that is not ASCII is not the token, and comparing the encoded bytes decides that in
    constant time rather than by raising.
    """
    return compare_digest(seen.encode("utf-8", "surrogatepass"),
                          token.encode("utf-8", "surrogatepass"))


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

    deadline = time.monotonic() + _TOTAL_DEADLINE
    try:
        with httpx.Client(follow_redirects=False, timeout=_TIMEOUT) as client:
            # Streamed, so the cap below is a limit on what we ever hold rather than a slice of what
            # we already read. The status is available before the body arrives, so the two answers
            # that end the question end it without reading anything at all.
            with client.stream("GET", url,
                               headers={"user-agent": "sloptic-verification/1.0"}) as r:
                if r.status_code in (404, 410):
                    # The only two answers that mean the file is genuinely absent.
                    return Factor("not_found", f"HTTP {r.status_code}")
                if r.status_code >= 300:
                    return Factor("blocked", f"HTTP {r.status_code}")

                buf = bytearray()
                for chunk in r.iter_bytes(1024):
                    if time.monotonic() > deadline:
                        return Factor("blocked", f"no answer within {_TOTAL_DEADLINE:.0f}s")
                    buf.extend(chunk)
                    if len(buf) > _MAX_TOKEN_BODY:
                        # Stop pulling. A token file is one line, so this is not a truncated token,
                        # it is a different thing entirely, and reading the rest to confirm that is
                        # exactly the invitation we are declining.
                        return Factor("not_found",
                                      f"what is served there is larger than {_MAX_TOKEN_BODY} bytes, "
                                      "so it is not this claim's token")
    except Exception as e:  # noqa: BLE001 - transport of any kind is "could not look"
        return Factor("blocked", f"{type(e).__name__}: {e}")

    body = buf.decode("utf-8", "replace").strip()
    if not body:
        return Factor("blocked", "empty body")
    # Never a substring test: a page that merely CONTAINS the token (a comment, a log viewer, an
    # error page echoing the URL) is not the same as a file that IS the token.
    if _token_eq(body, token):
        return Factor("ok")
    return Factor("not_found", "a file is served there, but it is not this claim's token")


def _query_txt(name: str):
    """TXT lookup, asked of resolvers chosen for this job rather than of whatever the network hands us.

    Proof of control is a question about the public DNS, so it is put to public resolvers
    (config.VERIFY_DNS_RESOLVERS) before the box's own. This is not only a workaround for one bad
    router: a resolver that mangles or hijacks answers for names that do not exist is exactly the
    wrong oracle for "is this record absent", and a split-horizon or poisoned local resolver could
    otherwise confirm a proof that the rest of the world cannot see.

    The first REAL answer wins, and NXDOMAIN and NoAnswer are real answers. A resolver that errors or
    times out is skipped rather than believed. The system resolver is the last resort, so a network
    that blocks public DNS still works, and if nothing answers the caller reports blocked and names
    what was tried.

    dnspython retries a truncated UDP answer over TCP by itself, so there is no manual ladder here.
    """
    import dns.resolver

    servers = list(config.VERIFY_DNS_RESOLVERS)
    attempts: list[str] = []
    last: Exception | None = None

    for server in servers + ["system"]:
        resolver = dns.resolver.Resolver()
        if server != "system":
            resolver.nameservers = [server]
        resolver.lifetime = _TIMEOUT
        try:
            return resolver.resolve(name, "TXT", lifetime=_TIMEOUT)
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            raise                       # a real answer, and the same from any honest resolver
        except Exception as e:          # noqa: BLE001 - could not ask THIS one; try the next
            attempts.append(f"{server}: {type(e).__name__}")
            last = e

    raise dns.resolver.NoNameservers(f"no resolver answered ({', '.join(attempts)})") from last


def check_dns(host: str, token: str) -> Factor:
    """Look for the token in a TXT record at _sloptic.<host>.

    dnspython is imported HERE, not at module scope, and that is not a style choice. Importing it at
    the top made a missing dependency crash the whole worker at boot: grading, event checks, retries
    and all, for want of a library that only this one function uses. A feature that cannot run should
    disable itself, not take down the service it was added to.
    """
    try:
        import dns.exception
        import dns.resolver
    except ModuleNotFoundError:
        # Reported as blocked, which is exactly what it is: we could not look. Never not_found, or an
        # owner would be told their record is missing because OUR worker is missing a library.
        return Factor("blocked", "DNS checking is unavailable on this worker (dnspython not installed)")

    # ABSOLUTE, with the trailing dot. Without it the stub applies the host's search domains, so a
    # box with `search example.edu` in resolv.conf would go looking for
    # _sloptic.theirdomain.com.example.edu and report an owner's correct record as missing.
    name = f"{DNS_LABEL}.{host}."

    try:
        answers = _query_txt(name)
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
        value = "".join(part.decode("utf-8", "replace") if isinstance(part, bytes) else str(part)
                        for part in rdata.strings).strip()
        if _token_eq(value, token):
            return Factor("ok")
    return Factor("not_found", "a TXT record is published, but it is not this claim's token")


def check(origin: str, host: str, token: str) -> Outcome:
    """Both factors. Neither short-circuits the other: an owner fixing one wants to see the other."""
    return Outcome(file=check_file(origin, token), dns=check_dns(host, token))
