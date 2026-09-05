"""Which local DNS stub can parse our TXT query, and how it has to be asked.

Owner verification needs a TXT lookup, and the worker box's systemd-resolved answered FORMERR to it:
"I could not parse your query", which is not an answer about the domain at all. This walks the two
local stubs against three ways of asking, so the failure can be attributed instead of guessed at.

  127.0.0.53   systemd-resolved's normal stub, where /etc/resolv.conf points. Caches, validates,
               rewrites: the most processing, and the most to go wrong.
  127.0.0.54   its proxy stub, which forwards upstream with far less handling. A different code
               path, which is the point of testing it.

Both are inside the egress sandbox already: egress.nft accepts all of 127.0.0.0/8 for the worker's
uid (the Lighthouse carve-out), before the internal-address drop.

RUN IT AS THE WORKER'S USER. The nftables rules are uid-scoped, so a run as anyone else is not
testing what the worker experiences:

  sudo -u sloptic /home/ian/sloptic-web/worker/.venv/bin/python \
      /home/ian/sloptic-web/worker/deploy/dns_probe.py

Reading it: NXDOMAIN and NoAnswer are real ANSWERS and mean the path works. NoNameservers, Timeout
and anything else mean we could not ask. The first column that answers for both names is the one
verify_domain should be using.
"""
import dns.resolver

EXISTS = "google.com."                    # definitely has TXT: an OK here proves the path works
OURS = "_sloptic.sloptic.org."            # not published yet: NXDOMAIN here is the CORRECT answer

def attempt(server, name, edns, tcp):
    r = dns.resolver.Resolver(configure=False)
    r.nameservers = [server]
    r.lifetime = 8
    if not edns:
        r.use_edns(False)
    try:
        ans = r.resolve(name, "TXT", tcp=tcp, lifetime=8)
        return f"OK, {len(ans)} record(s)"
    except dns.resolver.NXDOMAIN:
        return "NXDOMAIN (a real answer: no such name)"
    except dns.resolver.NoAnswer:
        return "NoAnswer (a real answer: name exists, no TXT)"
    except Exception as e:
        return f"{type(e).__name__}: {str(e)[:70]}"

# 10.0.0.1 is the LAN resolver systemd-resolved itself forwards to (resolvectl: "Current DNS Server:
# 10.0.0.1"), and egress.nft allows the worker to reach it on :53 directly. If the stubs are the
# broken part, this is the path that still works, and it is already inside the sandbox.
SERVERS = ("127.0.0.53", "127.0.0.54", "10.0.0.1")

import getpass
import subprocess

print(f"running as: {getpass.getuser()}")
print("(run this as BOTH the worker's user and your own: the nftables rules are uid-scoped, so a")
print(" difference between the two runs means the sandbox, and no difference means the resolver)")

for name, label in ((EXISTS, "a name that HAS TXT"), (OURS, "our verification name")):
    print(f"\n=== {label}: {name} ===")
    for server in SERVERS:
        for how, edns, tcp in (("udp +edns", True, False), ("udp -edns", False, False), ("tcp", False, True)):
            print(f"  {server:12} {how:10} -> {attempt(server, name, edns, tcp)}")

# The path glibc actually uses for getaddrinfo is D-Bus to systemd-resolved, NOT the stub listener,
# so it can work perfectly while every raw query above fails. That is worth knowing: the worker
# grades apps fine today, which means name resolution as such is not broken.
print("\n=== the path getaddrinfo uses (D-Bus, not the stub) ===")
for probe in (["resolvectl", "query", "google.com"], ["getent", "hosts", "google.com"]):
    try:
        out = subprocess.run(probe, capture_output=True, text=True, timeout=15)
        first = (out.stdout or out.stderr).strip().splitlines()
        print(f"  {' '.join(probe):32} -> {first[0][:80] if first else '(no output)'}")
    except Exception as e:
        print(f"  {' '.join(probe):32} -> {type(e).__name__}: {e}")
