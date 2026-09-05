"""What the resolvers actually ANSWER, by response code, not by dnspython's exception.

The first probe read exceptions, which collapse several very different failures into one word. This
sends the query itself and prints the rcode that comes back:

  NOERROR   fine
  FORMERR   "I could not parse your query"      (the query is the problem)
  SERVFAIL  "I tried and failed"                (upstream or validation is the problem)
  NXDOMAIN  "no such name"                      (a real answer)
  REFUSED   "I will not answer you"             (policy: ACLs, wrong view, rate limit)

Varies three things independently, so the failure can be attributed rather than guessed at:
  record type   A is small and universally allowed; TXT is neither
  answer size   google.com TXT is well over 512 bytes; _dmarc.google.com TXT is small
  name          ours, which should be NXDOMAIN

  python3 worker/deploy/dns_probe2.py
"""
import dns.message
import dns.query
import dns.rcode

SERVERS = ("127.0.0.53", "10.0.0.1")
CASES = [
    ("google.com.", "A", "small answer, the most ordinary query there is"),
    ("_dmarc.google.com.", "TXT", "TXT, but a SMALL one, and an underscore label like ours"),
    ("google.com.", "TXT", "TXT, a LARGE one: over 512 bytes, needs EDNS or TCP"),
    ("_sloptic.sloptic.org.", "TXT", "ours: NXDOMAIN is the correct answer"),
]


def ask(server, name, rdtype, tcp, edns):
    q = dns.message.make_query(name, rdtype, use_edns=(0 if edns else False))
    try:
        r = (dns.query.tcp if tcp else dns.query.udp)(q, server, timeout=6)
        code = dns.rcode.to_text(r.rcode())
        extra = ""
        if r.flags & dns.flags.TC:
            extra = " [TRUNCATED: needs TCP]"
        return f"{code}{extra}, {len(r.answer)} answer section(s)"
    except Exception as e:
        return f"{type(e).__name__}: {str(e)[:45]}"


for name, rdtype, why in CASES:
    print(f"\n=== {rdtype} {name}\n    {why}")
    for server in SERVERS:
        for how, tcp, edns in (("udp +edns", False, True), ("udp -edns", False, False), ("tcp", True, False)):
            print(f"  {server:12} {how:10} -> {ask(server, name, rdtype, tcp, edns)}")
