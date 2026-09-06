"""What check_file will and will not read from a stranger's server.

This function fetches a URL chosen by whoever filed the claim, and it runs INLINE in the supervisor
loop, so whatever it does to itself it does to grading, claiming and cancelling as well. These are
about the shape of the response rather than about who is authorized: the questions are how long we
will wait, how much we will hold, and what we do with bytes that are not the ASCII we expected.

No database and no network: a MockTransport stands in for the stranger's server.
"""
from __future__ import annotations

import time

import httpx
import pytest

from sloptic_web_worker import verify_domain

TOKEN = "sloptic-" + "a" * 43
URL_HOST = "https://example.com"


class _Dribble(httpx.SyncByteStream):
    """A body that arrives one small piece at a time and never ends. Every piece resets httpx's read
    timeout, which is the whole trick: the connection is never idle long enough to look slow."""

    def __init__(self, gap: float = 0.05):
        self.gap = gap
        self.chunks_sent = 0

    def __iter__(self):
        while True:
            time.sleep(self.gap)
            self.chunks_sent += 1
            yield b"x" * 8


class _Flood(httpx.SyncByteStream):
    """A body far larger than a token file, delivered as fast as we will take it."""

    def __init__(self, total: int = 4 * 1024 * 1024):
        self.total = total
        self.sent = 0

    def __iter__(self):
        while self.sent < self.total:
            self.sent += 65536
            yield b"y" * 65536


@pytest.fixture(autouse=True)
def _no_egress(monkeypatch):
    """The sandbox is tested elsewhere; these are about what happens after it says yes."""
    monkeypatch.setattr(verify_domain.egress, "guard_target", lambda *a, **k: None)


def _serve(monkeypatch, response: httpx.Response):
    real = httpx.Client

    def _client(*a, **kw):
        kw["transport"] = httpx.MockTransport(lambda _req: response)
        return real(*a, **kw)

    monkeypatch.setattr(verify_domain.httpx, "Client", _client)


class TestTheFetchCannotBeHeldOpen:
    def test_a_body_that_dribbles_for_ever_is_refused_at_the_deadline(self, monkeypatch):
        """The bug this pins: httpx's timeout is per operation, so a chunk every few milliseconds
        resets it for ever and the supervisor loop stops with it."""
        monkeypatch.setattr(verify_domain, "_TOTAL_DEADLINE", 0.4)
        _serve(monkeypatch, httpx.Response(200, stream=_Dribble(gap=0.02)))

        started = time.monotonic()
        out = verify_domain.check_file(URL_HOST, TOKEN)
        elapsed = time.monotonic() - started

        assert out.status == "blocked"
        assert elapsed < 5.0, f"check_file ran for {elapsed:.1f}s: the deadline is not enforced"

    def test_the_deadline_is_could_not_look_never_absence(self, monkeypatch):
        """Timing out is our failure, not evidence the owner published nothing. not_found here would
        expire an honest claim."""
        monkeypatch.setattr(verify_domain, "_TOTAL_DEADLINE", 0.3)
        _serve(monkeypatch, httpx.Response(200, stream=_Dribble(gap=0.02)))

        assert verify_domain.check_file(URL_HOST, TOKEN).status == "blocked"


class TestTheFetchCannotBeMadeHuge:
    def test_a_flood_stops_being_read_near_the_cap(self, monkeypatch):
        flood = _Flood(total=4 * 1024 * 1024)
        _serve(monkeypatch, httpx.Response(200, stream=flood))

        out = verify_domain.check_file(URL_HOST, TOKEN)

        assert out.status == "not_found"
        assert flood.sent <= verify_domain._MAX_TOKEN_BODY + 65536, (
            f"read {flood.sent} bytes for a {verify_domain._MAX_TOKEN_BODY}-byte cap")


class TestBytesThatAreNotTheAsciiWeExpected:
    def test_an_accented_page_does_not_raise(self, monkeypatch):
        """compare_digest refuses non-ASCII str. A Spanish catch-all 200 is an ordinary thing for an
        app to serve, and it used to strand the claim as blocked for ever."""
        _serve(monkeypatch, httpx.Response(200, text="Página no encontrada"))

        assert verify_domain.check_file(URL_HOST, TOKEN).status == "not_found"

    def test_undecodable_bytes_do_not_raise(self, monkeypatch):
        _serve(monkeypatch, httpx.Response(200, content=b"\xff\xfe\x00 not utf-8"))

        assert verify_domain.check_file(URL_HOST, TOKEN).status == "not_found"


class TestTheAnswersThatStillHaveToWork:
    def test_the_token_still_verifies(self, monkeypatch):
        _serve(monkeypatch, httpx.Response(200, text=TOKEN + "\n"))
        assert verify_domain.check_file(URL_HOST, TOKEN).status == "ok"

    def test_a_missing_file_is_absence(self, monkeypatch):
        _serve(monkeypatch, httpx.Response(404))
        assert verify_domain.check_file(URL_HOST, TOKEN).status == "not_found"

    def test_a_redirect_is_not_followed_and_is_not_absence(self, monkeypatch):
        _serve(monkeypatch, httpx.Response(302, headers={"location": "https://elsewhere.example/"}))
        assert verify_domain.check_file(URL_HOST, TOKEN).status == "blocked"

    def test_a_waf_challenge_is_could_not_look(self, monkeypatch):
        _serve(monkeypatch, httpx.Response(403))
        assert verify_domain.check_file(URL_HOST, TOKEN).status == "blocked"

    def test_a_wrong_token_is_absence_not_a_match(self, monkeypatch):
        _serve(monkeypatch, httpx.Response(200, text="sloptic-" + "b" * 43))
        assert verify_domain.check_file(URL_HOST, TOKEN).status == "not_found"

    def test_a_page_merely_containing_the_token_does_not_verify(self, monkeypatch):
        _serve(monkeypatch, httpx.Response(200, text=f"<html>token is {TOKEN} ok</html>"))
        assert verify_domain.check_file(URL_HOST, TOKEN).status == "not_found"
