# Egress sandbox: scope and implementation plan

Status: scoped, not started. This is the P0 between here and flipping `GRADING_OPEN`.

## The problem in three lines

The worker dials whatever URL a stranger submits, from inside the home LAN (10.0.0.0/24, grader
machine at 10.0.0.16). Unchecked, the public form is an open proxy into that LAN, and the worker's
residential IP becomes the attribution for whatever paths a submitter aims at third parties. The
sandbox narrows "any destination a stranger names" to "public destinations only," at every layer
that opens a socket.

## Where the control lives

The control must live where sockets are opened. That is the grader machine, never Vercel. The web
API's resolve precheck (in `POST /api/grade`) is an early, polite denial for UX only; a determined
client cannot be trusted to have passed it, and Vercel opens none of the sockets anyway.

Three tiers, each covering a different way traffic leaves the machine. No single tier is trusted.

| tier | what it covers | lives in |
|---|---|---|
| resolve + pin + hop scoping | every httpx request the grader makes, including redirects | `sloptic-main` (`net.py`, `deploy.py`, `baas.py`) |
| browser route filter | every request Chromium makes (subresources, XHR, page-initiated fetches) | `sloptic-main` (`browser.py`) |
| OS egress deny | everything above failing, in code or in Chromium's own DNS | the machine (nftables), configured at deploy time |
| worker gate + self-test | refusing to run at all unless 1 to 3 are proven | `sloptic-web` (`worker/sloptic_web_worker/egress.py`) |

The grader-side tiers belong in `sloptic-main`, not in this repo. CLAUDE.md forbids forking grader
logic here, the worker's own `egress.py` docstring says the same, and corpus runs from the machine
inherit the protection for free. The worker keeps only the fail-closed gate, the readiness flag, and
the self-test.

## Current call-site audit (found by reading, 2026-08-30)

All of these must pass through the safe path before the sandbox can be declared real.

- `net.make_client`: the shared client most probes use. The safe transport lands here first, one
  change every probe inherits.
- `deploy.py:257`: `RemoteDeployer` liveness check calls plain `httpx.get(..., follow_redirects=True)`.
  Bypasses `make_client` entirely. Must route through it, and redirect-following must become a scoped
  loop.
- `baas.py`: ten raw `httpx.Client` / `httpx.post` / `httpx.get` call sites (the Supabase and
  Firebase backend-exposure battery), several with `follow_redirects=True`. Bypasses `make_client`.
  The highest-value probe class is also the least guarded; this is the audit's main finding.
- Correction (2026-08-30, on reading the site): `deploy.py:35` is `_free_port()`, a loopback bind
  allocating a local port for the trusted-reference-app deployer. Inbound-local, never dials a
  remote; not an egress concern.
- Design constraint found the same way: the grader's own validation lane grades reference apps on
  `127.0.0.1`, so the safe transport needs an explicit local opt-out or it breaks the grader's own
  tests. `make_client(egress_safe=False)` is that opt-out; the default is safe.
- `oob.py`: binds a local UDP listener for out-of-band callbacks. Inbound-local, not an egress path,
  noted so the audit is visibly complete.
- `browser.py` `_launch` (line 134) and its context creation: where the route filter and launch args go.

## Phases

**Phase 0: OS egress deny. DONE 2026-08-30.** Pure config on the grader machine, protects today's corpus runs
immediately, costs nothing. nftables rules scoped to the worker's uid or container (the machine is a
shared desktop), dropping egress to RFC1918, loopback, link-local, CGNAT, and 169.254.169.254, with
one carve-out: DNS (UDP and TCP 53) to the router resolver at 10.0.0.1, which the resolve-and-pin
step itself needs. No inbound anywhere; the worker only ever polls Supabase outbound. Verified live
on the machine: worker-uid fetch of the router times out (drop counter ticked), own-user fetch
unaffected, worker-uid public fetch over the resolved-stub carve-out succeeds. Ruleset:
`worker/deploy/egress.nft`.

**Phase 1: safe transport in the grader. DONE 2026-08-30 (sloptic-main `964c518`).** Landed as a
RESOLVER-LEVEL chokepoint rather than a per-callsite transport, superseding the migration list
below. Verified empirically first: httpx 0.28 (httpcore via anyio) resolves every connection
through `socket.getaddrinfo`, IP literals included, so guarding that one function covers
`make_client`, all ~30 raw sites in baas/auth/probes/email_verify/deploy, raw
`socket.create_connection` users, and every redirect hop, with no per-callsite edits (which also
avoids UA drift on probes whose measured behavior depends on the current client identity). The
guard (`sloptic/egress.py`) resolves through the real resolver, validates every address
all-or-nothing, and returns the original addrinfo list, which pins the dial to the validated
address, closing the rebinding window. `origin_scope()` pins a context to one scheme+host+port
(the web lane; a hop leaving the submitted origin refuses, public or not). Modes via
`SLOPTIC_EGRESS`: `on` default, `local` (loopback allowed, set by the CLI for the subprocess/docker
reference lanes and by the test conftest), `off` (bypass, never in the worker). `RemoteDeployer`'s
liveness fetch moved onto `make_client` (real-Chrome UA + h2 for the first request a WAF sees, and
a non-public target reads as "did not respond"). Tests: `tests/test_egress.py`, 28 offline cases
covering all four attack shapes. The audit list below is retained as history; the resolver design
makes the baas/auth/probes migrations unnecessary for safety.

**Phase 2: browser route filter in the grader.** `context.route("**/*")` at context creation in
`browser.py`: resolve each requested hostname, `check_ip()` every address, abort or continue. Honest
limit, stated so nobody trusts it for more than it does: Chromium resolves DNS itself after the
check, so a TTL-0 rebinding host has a narrow window there. The Phase 0 nftables drop is what closes
that window; that is the layering working as designed.

**Phase 3: worker glue, then the flags.** Deploy the worker to the grader machine properly (clone
this repo, root `.env`, container, nftables scoping from Phase 0). `guard_target()` already fails
closed; extend `egress.py` to run the self-test below, and set `EGRESS_SANDBOX_READY=1` only when it
passes. `GRADING_OPEN` stays off until the daily budget and the challenge circuit breaker (the
`retry_blocked.py` lesson, global not per-app) also exist, because those protect the IP reputation
the deployment depends on, and they are separate controls from this one.

## Self-test, the definition of done

`EGRESS_SANDBOX_READY=1` only after all of these pass on the machine:

1. `curl http://10.0.0.1/` from the worker's uid or container dies; from a normal user it works
   (proves the OS tier is scoped, not broken).
2. A grade of `http://10.0.0.1/` is refused at the gate, nothing fetched.
3. A public URL that 302s to `http://10.0.0.1/` is refused at the hop, grade marked off-origin.
4. A hostname that resolves public at check time and private at connect time is refused at connect
   (local dnsmasq override as the harness).
5. A page embedding `<img src="http://10.0.0.1/x">` has that request aborted by the route filter.
6. A real public target still grades end to end with a score identical to a pre-sandbox run of the
   same target (no functional regression).
7. Raw-httpx audit re-run: `grep` finds no `httpx.` call site outside the safe path.

## Out of scope, on purpose

- Authorization (who may grade what) is the verification tier, v2. The sandbox is unconditional and
  knows nothing about accounts.
- Rate limiting and quotas, including the daily grade budget and challenge circuit breaker, are
  adjacent controls shipped alongside Phase 3, not part of the sandbox.
- Versioning: grader-side changes ship as a `sloptic` release (2.1.0 or later), and the worker pins
  it, which also closes the long-pending task of moving the worker off the editable clone.
