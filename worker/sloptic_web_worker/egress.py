"""Worker-side egress gate.

THE SANDBOX ITSELF IS NOT HERE. It lives in three places, none of them this file:

  1. the grader's resolver guard, `sloptic.egress` (shipped in sloptic 2.1.0): every outbound
     resolution in-process, httpx and raw sockets alike, redirect hops included, refuses any
     destination that is not public;
  2. the grader's browser route filter, `sloptic.browser`: every request Chromium initiates;
  3. the OS, `worker/deploy/egress.nft`: a uid-scoped nftables deny on the grader machine, which is
     the only tier that covers Lighthouse's own Chrome and closes Chromium's rebinding window.

This module is only the worker's gate ON TOP of those: install the guard for this process, refuse to
grade at all until the sandbox is declared ready on this host, and reject a target that resolves
somewhere it should not before any grading work starts.

Nothing here re-implements the predicate. `check_ip` and `host_allowed` ARE the grader's, imported,
so a fix or an added range there (NAT64 64:ff9b::/96 and IPv4-compatible ::/96 are on the grader's
backlog) covers the worker for free. CLAUDE.md: the grader is a dependency, never forked.
"""

from urllib.parse import urlparse

from sloptic import egress as _grader

# The grader's predicate and scoping, re-exported so worker code has one obvious import.
check_ip = _grader.check_ip
host_allowed = _grader.host_allowed
origin_scope = _grader.origin_scope


def install() -> None:
    """Install the grader's resolver guard in THIS process. Idempotent.

    The guard is opt-in as of sloptic 2.1.0 (it no longer patches `socket.getaddrinfo` at import, for
    library hygiene). `pipeline.run()` installs it itself, so every grade is guarded either way; the
    worker also installs it once at startup so anything it does OUTSIDE a grade -- a health check, a
    future verification fetch, origin_scope setup -- is guarded too.
    """
    _grader.install()


class EgressNotReady(RuntimeError):
    """Raised to fail closed when the sandbox is not declared ready on this host."""


def guard_target(origin: str, host: str) -> None:
    """Pre-flight a job before any grading work. Fails closed.

    Raises EgressNotReady when the host has not been vouched for (EGRESS_SANDBOX_READY), or
    ValueError when the target resolves to a non-public address. The grader would refuse the
    connection anyway; doing it here turns that into a clear, early, logged refusal instead of a
    grade that dies partway through.
    """
    from . import config

    if not config.EGRESS_SANDBOX_READY:
        raise EgressNotReady(
            "egress sandbox not declared ready on this host: refusing to grade a real target. "
            "The code tiers ship with the grader; set EGRESS_SANDBOX_READY=1 only once the OS tier "
            "(worker/deploy/egress.nft) is loaded AND the self-test in docs/egress-plan.md passes."
        )
    install()
    # host_allowed permits a host that does not resolve at all (there is nothing to protect against,
    # and the grade then fails as plainly unreachable, which is the clearer error). So this rejects
    # exactly one thing: a target that resolves somewhere internal.
    if not host or not host_allowed(host, urlparse(origin).port or 443):
        raise ValueError(f"target resolves to a non-public address: {host}")
