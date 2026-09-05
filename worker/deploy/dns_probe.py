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
        return f"{type(e).__name__}: {str(e)[:60]}"

for name, label in ((EXISTS, "a name that HAS TXT"), (OURS, "our verification name")):
    print(f"\n=== {label}: {name} ===")
    for server in ("127.0.0.53", "127.0.0.54"):
        for how, edns, tcp in (("udp +edns", True, False), ("udp -edns", False, False), ("tcp", False, True)):
            print(f"  {server}  {how:10} -> {attempt(server, name, edns, tcp)}")
