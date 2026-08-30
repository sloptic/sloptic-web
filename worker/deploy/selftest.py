#!/usr/bin/env python3
"""Egress sandbox self-test. Run ON THE GRADER MACHINE, AS THE SERVICE USER, before setting
EGRESS_SANDBOX_READY=1:

    sudo -u sloptic /home/ian/sloptic-web/worker/.venv/bin/python worker/deploy/selftest.py

Every check must pass. This verifies the DEPLOYED environment, not the code: the grader's own suite
(tests/test_egress.py) already proves the logic, what this proves is that the tiers are actually
active for THIS process, as THIS user, on THIS box. Exit code 0 = safe to set the flag.
"""
import os
import pwd
import socket
import subprocess
import sys
import time

FAILS = []


def check(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:                       # a check that crashes is a failed check
        ok, detail = False, f"{type(e).__name__}: {e}"
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)
    if not ok:
        FAILS.append(name)


def c_user():
    """The OS tier matches `meta skuid sloptic`. Any other uid and the firewall covers nothing --
    including Lighthouse's Chrome, which no code tier can see."""
    u = pwd.getpwuid(os.getuid()).pw_name
    return u == "sloptic", f"running as {u!r} (uid {os.getuid()})"


def c_nftables():
    """Read the ruleset if we can. Reading it requires CAP_NET_ADMIN, which the service user
    deliberately does not have, so a permission error here is EXPECTED and not a failure: the
    authoritative evidence is the behavioral drop check below, which needs no privilege at all."""
    p = subprocess.run(["nft", "list", "table", "inet", "sloptic_egress"],
                       capture_output=True, text=True)
    if p.returncode == 0:
        scoped = f"skuid {os.getuid()}" in p.stdout
        return scoped, f"table loaded; scoped to uid {os.getuid()}: {scoped}"
    err = ((p.stderr or "") + (p.stdout or "")).strip()
    if "permitted" in err.lower() or "permission" in err.lower():
        return True, "not readable as an unprivileged user (expected); the drop check below is the proof"
    return False, f"nft failed: {err[:140]}"


def c_os_drop():
    """OS tier: a raw socket to the LAN must die in the kernel, with no help from Python."""
    s = socket.socket()
    s.settimeout(3)
    t0 = time.time()
    try:
        s.connect(("10.0.0.1", 80))
        return False, "CONNECTED to 10.0.0.1 -- the OS tier is not filtering this process"
    except (socket.timeout, TimeoutError):
        return True, f"timed out after {time.time()-t0:.1f}s (dropped)"
    except OSError as e:
        return False, f"refused rather than dropped ({e}); expected a silent drop"
    finally:
        s.close()


def c_loopback_reaches_the_stack():
    """Loopback must NOT be dropped at the OS tier: Lighthouse drives Chrome over the DevTools
    protocol on 127.0.0.1, and dropping it starves the whole performance axis while the grade still
    reports success (observed 2026-08-30: slop 22, twelve perf probes N/A). A REFUSED connection
    proves the packet reached the kernel; a TIMEOUT means nftables is eating it. Loopback stays
    refused by both code tiers in strict mode, which is what keeps this safe."""
    s = socket.socket()
    s.settimeout(3)
    try:
        s.connect(("127.0.0.1", 1))
        return True, "connected on port 1 (open, and permitted)"
    except ConnectionRefusedError:
        return True, "refused by the stack, not dropped: Lighthouse can dial Chrome"
    except (socket.timeout, TimeoutError):
        return False, ("timed out: the OS tier is DROPPING loopback, so Lighthouse cannot reach the "
                       "Chrome it launches and the performance axis will silently read N/A")
    finally:
        s.close()


def c_strict_mode():
    """The worker must never set SLOPTIC_EGRESS: unset means strict."""
    from sloptic import egress
    m = egress.mode()
    return m == "on", f"SLOPTIC_EGRESS={os.environ.get('SLOPTIC_EGRESS') or '(unset)'} -> mode {m!r}"


def c_resolver_guard():
    """Tier 1: after install(), a private literal is refused before any packet leaves."""
    from sloptic import egress
    egress.install()
    try:
        socket.getaddrinfo("10.0.0.1", 80)
        return False, "resolved 10.0.0.1 -- guard not installed"
    except egress.EgressRefused as e:
        return True, str(e)


def c_public_still_works():
    """The guard must not break normal grading: a public host still resolves and connects."""
    import httpx
    r = httpx.get("https://example.com", timeout=15)
    return r.status_code == 200, f"example.com -> HTTP {r.status_code}"


def c_browser_filter():
    """Tier 2: a page naming a LAN subresource must have that request aborted.

    The page is built IN the browser with set_content, not served from a local HTTP server. A
    loopback fixture cannot work here and should not: the OS tier drops 127.0.0.0/8 for this uid on
    purpose, because a service bound to localhost is exactly the kind of thing SSRF goes looking
    for. Building the document in-browser also lets this run in the real strict mode instead of
    relaxing the guard to make the fixture reachable.
    """
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/ms-playwright")
    os.environ.setdefault("HOME", "/var/lib/sloptic")

    from playwright.sync_api import sync_playwright

    from sloptic import browser

    ok, detail = browser.browser_preflight()
    if not ok:
        return False, (f"chromium will not launch: {detail}. "
                       f"PLAYWRIGHT_BROWSERS_PATH={os.environ.get('PLAYWRIGHT_BROWSERS_PATH')} "
                       f"HOME={os.environ.get('HOME')}")

    failed = []
    with sync_playwright() as pw:
        b = browser._launch(pw)
        if b is None:
            return False, f"chromium would not launch: {browser._LAST_LAUNCH_ERROR}"
        try:
            page = b.new_page()
            page.on("requestfailed", lambda r: failed.append(r.url))
            page.set_content(
                "<p id=ok>loaded</p><img src='http://10.0.0.1/x.png'>",
                wait_until="domcontentloaded",
            )
            page.wait_for_timeout(2500)      # let the subresource be attempted and refused
            rendered = page.text_content("#ok")
        finally:
            b.close()

    hit = any("10.0.0.1" in u for u in failed)
    return hit and rendered == "loaded", (
        f"LAN subresource aborted={hit}, page rendered={rendered!r}"
        + ("" if hit else f"; requests that failed: {failed or '(none)'}"))


def c_gate_closed_by_default():
    """The worker gate must refuse to grade when the sandbox is not declared ready.

    Tests BEHAVIOR, not the environment: it forces the flag off and asserts guard_target raises,
    then restores it. Reading os.environ here was wrong -- the flag arrives via dotenv from the root
    .env, not as a real environment variable in a manual run, so the check disagreed with the code
    it was testing and reported a failure that did not exist.
    """
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    from sloptic_web_worker import config
    from sloptic_web_worker.egress import EgressNotReady, guard_target

    original = config.EGRESS_SANDBOX_READY
    try:
        config.EGRESS_SANDBOX_READY = False
        try:
            guard_target("https://example.com", "example.com")
            return False, "guard_target allowed a target while the sandbox was marked NOT ready"
        except EgressNotReady:
            pass
    finally:
        config.EGRESS_SANDBOX_READY = original

    # And with the flag at its real value, an internal target must still be rejected.
    if original:
        try:
            guard_target("http://10.0.0.1/", "10.0.0.1")
            return False, "guard_target allowed an internal target with the flag set"
        except ValueError:
            return True, "refuses when not ready, and refuses internal targets when ready"
    return True, "fails closed while EGRESS_SANDBOX_READY is unset"


def c_runtime_env():
    """The caches a nologin service user cannot otherwise have. The unit sets these; a manual run
    must too, or the browser and Lighthouse lanes fail for reasons unrelated to egress."""
    import pathlib
    bp = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/ms-playwright")
    home = os.environ.get("HOME", "/var/lib/sloptic")
    problems = []
    if not pathlib.Path(bp).is_dir():
        problems.append(f"browsers path {bp} missing")
    if not os.access(home, os.W_OK):
        problems.append(f"HOME {home} not writable (npx/Lighthouse needs it)")
    return not problems, "; ".join(problems) or f"browsers={bp} home={home}"


print("egress sandbox self-test\n")
check("service user is `sloptic`", c_user)
check("runtime env matches the unit", c_runtime_env)
check("nftables table loaded, scoped to this uid", c_nftables)
check("OS tier drops a raw LAN connect", c_os_drop)
check("OS tier permits loopback (Lighthouse needs it)", c_loopback_reaches_the_stack)
check("strict egress mode", c_strict_mode)
check("resolver guard refuses a private literal", c_resolver_guard)
check("public targets still reachable", c_public_still_works)
check("browser filter aborts a LAN subresource", c_browser_filter)
check("worker gate fails closed", c_gate_closed_by_default)

print()
if FAILS:
    print(f"FAILED: {len(FAILS)} check(s): {', '.join(FAILS)}")
    print("Do NOT set EGRESS_SANDBOX_READY=1.")
    sys.exit(1)
print("All checks passed. Safe to set EGRESS_SANDBOX_READY=1 in the root .env, then:")
print("  sudo systemctl enable --now sloptic-worker")
