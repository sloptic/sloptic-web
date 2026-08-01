"""EGRESS SANDBOX + REDIRECT-SCOPING — the P0 security control (see CLAUDE.md, the handoff).

STATUS: NOT IMPLEMENTED. This module is the single chokepoint where it drops in. Until it is done, the
worker MUST NOT fetch untrusted URLs, so `guard_target()` fails closed unless EGRESS_SANDBOX_READY is set.

The grader fires HTTP at a user-supplied URL. Without this control the service is an SSRF/DoS relay:
`sloptic.net.make_client` defaults verify=False with no IP blocklist, and `RemoteDeployer` follows
redirects with no origin scoping, so even a passive grade can be walked to 169.254.169.254 or an RFC1918
address. What has to land here (or, better, in the grader's net.py so every consumer inherits it):

  1. A resolve-and-block DNS+connect guard on EVERY outbound socket: block loopback / RFC1918 /
     link-local / 169.254.169.254 / CGNAT / IPv6 ULA + mapped equivalents. Re-check at CONNECT time,
     not just once (DNS rebinding), e.g. a custom httpx transport / socket connect hook.
  2. Redirect-scoping: a 3xx must not carry the grade off the submitted origin (scheme+host+port).
  3. Host-level defense in depth: a network egress deny for internal ranges on the worker host, so a
     code bug cannot reach internal infra even if (1) is bypassed.

`check_ip()` below is the address predicate the guard will use; it is ready. The socket/transport
wiring and redirect-scoping are the missing pieces.
"""

import ipaddress
import socket


def check_ip(ip: str) -> bool:
    """True if this resolved address is SAFE to connect to (a public unicast address)."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or (isinstance(addr, ipaddress.IPv4Address) and addr in ipaddress.ip_network("100.64.0.0/10"))
    )


def resolve_ok(host: str) -> bool:
    """Resolve a host and return True only if EVERY resolved address is safe. (First gate; a full guard
    must also re-check at connect time to defeat DNS rebinding.)"""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    ips = {info[4][0] for info in infos}
    return bool(ips) and all(check_ip(ip) for ip in ips)


class EgressNotReady(RuntimeError):
    """Raised to fail closed while the egress sandbox is unimplemented."""


def guard_target(origin: str, host: str) -> None:
    """Called before any grade. FAILS CLOSED until the sandbox is implemented and enabled.

    Raises EgressNotReady if the sandbox is not marked ready, or ValueError if the host is internal.
    """
    from . import config

    if not config.EGRESS_SANDBOX_READY:
        raise EgressNotReady(
            "egress sandbox not implemented (P0): refusing to grade a real target. "
            "See egress.py; set EGRESS_SANDBOX_READY=1 only once the chokepoint is done."
        )
    if not resolve_ok(host):
        raise ValueError(f"target resolves to a non-public or unresolvable address: {host}")
