"""Owner verification: the two proofs, and the grant they earn.

The grant this produces is what lets attack payloads be aimed at a server, so the questions here are
about who gets one and who does not, and about the difference between a proof that is ABSENT and a
proof we could not LOOK at.
"""
from __future__ import annotations

from sloptic_web_worker import config, db, verify_domain


def _claim(conn, account, *, origin="https://example.com", host="example.com",
           token="sloptic-test-token", status="pending", due="now()"):
    row = conn.execute(
        f"""INSERT INTO domain_claims (account_id, origin, host, token, status, check_due_at)
            VALUES (%s, %s, %s, %s, %s, {due}) RETURNING id""",
        (account, origin, host, token, status),
    ).fetchone()
    return str(row["id"])


def _accept_terms(conn, account):
    conn.execute(
        "INSERT INTO profiles (id, terms_accepted_at) VALUES (%s, now()) "
        "ON CONFLICT (id) DO UPDATE SET terms_accepted_at = now()",
        (account,),
    )


def _row(conn, cid):
    return conn.execute("SELECT * FROM domain_claims WHERE id = %s", (cid,)).fetchone()


def _grants(conn, account):
    return conn.execute(
        "SELECT kind, scope, expires_at, revoked_at FROM grants WHERE account_id = %s", (account,)
    ).fetchall()


class TestTheToken:
    def test_every_token_is_different(self):
        # Positional security, not textual: reading Alice's token confers nothing, because Mallory's
        # claim carries a different one. That only holds if they really are different, and
        # unguessable, or someone could pre-place a token for a domain they are about to be asked
        # about.
        tokens = {verify_domain.new_token() for _ in range(200)}
        assert len(tokens) == 200

    def test_a_token_is_long_enough_to_be_unguessable(self):
        t = verify_domain.new_token()
        assert t.startswith("sloptic-")
        assert len(t) > 40


class TestClaimingAndChecking:
    def test_takes_the_oldest_claim_that_is_due(self, conn, account):
        old = _claim(conn, account, origin="https://old.example.com", host="old.example.com",
                     token="t-old", due="now() - interval '10 minutes'")
        _claim(conn, account, origin="https://new.example.com", host="new.example.com", token="t-new")
        assert db.claim_domain_check(conn).id == old

    def test_a_claim_not_yet_due_is_left_alone(self, conn, account):
        _claim(conn, account, due="now() + interval '5 minutes'")
        assert db.claim_domain_check(conn) is None

    def test_the_claim_is_pushed_out_so_it_is_not_handed_out_twice(self, conn, account):
        _claim(conn, account)
        assert db.claim_domain_check(conn) is not None
        assert db.claim_domain_check(conn) is None

    def test_two_workers_never_take_the_same_claim(self, conn, second, account):
        a = _claim(conn, account, origin="https://a.example.com", host="a.example.com", token="t-a")
        b = _claim(conn, account, origin="https://b.example.com", host="b.example.com", token="t-b")
        first = db.claim_domain_check(conn)
        other = db.claim_domain_check(second)
        assert {first.id, other.id} == {a, b}

    def test_a_settled_claim_is_not_checked_again(self, conn, account):
        # failed and revoked are ENDED. Verified is not: it is watched, because the proofs have to
        # stay published and an active grade re-reads them every time.
        for status in ("failed", "revoked"):
            conn.execute("TRUNCATE domain_claims CASCADE")
            _claim(conn, account, status=status)
            assert db.claim_domain_check(conn) is None, status

    def test_a_verified_claim_is_still_checked(self, conn, account):
        conn.execute("TRUNCATE domain_claims CASCADE")
        _claim(conn, account, status="verified")
        assert db.claim_domain_check(conn) is not None


class TestRecordingWhatWeSaw:
    def test_a_missing_proof_leaves_the_claim_pending(self, conn, account):
        # Still publishing is not failing. A claim that has not been proven yet is exactly the state
        # someone is in while they edit their DNS.
        cid = _claim(conn, account)
        db.record_domain_check(conn, cid, "ok", "not_found", "no _sloptic record", 60)
        row = _row(conn, cid)
        assert row["status"] == "pending"
        assert row["file_status"] == "ok"
        assert row["dns_status"] == "not_found"

    def test_a_blocked_proof_is_never_recorded_as_absent(self, conn, account):
        # The lesson the Devpost path wrote down: blocked means WE COULD NOT LOOK. Collapsing it onto
        # not_found tells an owner their token is missing when their server would not answer us.
        cid = _claim(conn, account)
        db.record_domain_check(conn, cid, "blocked", "blocked", "timeout", 900)
        row = _row(conn, cid)
        assert row["file_status"] == "blocked"
        assert row["status"] == "pending"

    def test_no_grant_is_written_by_merely_looking(self, conn, account):
        cid = _claim(conn, account)
        db.record_domain_check(conn, cid, "ok", "not_found", "half way", 60)
        assert _grants(conn, account) == []


class TestTheGrant:
    def test_both_proofs_earn_an_account_bound_origin_scoped_grant(self, conn, account):
        _accept_terms(conn, account)
        cid = _claim(conn, account)
        claim = db.claim_domain_check(conn)
        assert db.verify_domain_claim(conn, claim, "both found", 90) == "granted"

        row = _row(conn, cid)
        assert row["status"] == "verified"
        assert row["verified_at"] is not None
        grants = _grants(conn, account)
        assert len(grants) == 1
        assert grants[0]["kind"] == "app_origin"
        # Scoped to the ORIGIN, because that is what a grade compares against.
        assert grants[0]["scope"] == "https://example.com"
        assert grants[0]["expires_at"] is not None

    def test_the_grant_is_time_boxed(self, conn, account):
        # CLAUDE.md: grants are time-boxed and re-verified before an active grade. A permanent grant
        # would outlive the ownership it was based on, which is what expiry exists to prevent.
        _accept_terms(conn, account)
        _claim(conn, account)
        db.verify_domain_claim(conn, db.claim_domain_check(conn), "both found", 90)
        days = conn.execute(
            "SELECT extract(day from (expires_at - now())) AS d FROM grants WHERE account_id = %s",
            (account,),
        ).fetchone()["d"]
        assert 88 <= days <= 90

    def test_no_terms_means_no_grant_however_good_the_proofs(self, conn, account):
        # The attestation is one of the layers the active tier rests on. A grant issued without it
        # is one nobody agreed to, so the proofs are recorded and the authorization is withheld.
        cid = _claim(conn, account)
        claim = db.claim_domain_check(conn)
        assert db.verify_domain_claim(conn, claim, "both found", 90) == "blocked_on_terms"
        assert _grants(conn, account) == []
        assert _row(conn, cid)["status"] == "pending"

    def test_re_verifying_refreshes_the_window_rather_than_stacking_grants(self, conn, account):
        _accept_terms(conn, account)
        _claim(conn, account)
        db.verify_domain_claim(conn, db.claim_domain_check(conn), "first", 90)
        conn.execute("UPDATE domain_claims SET status = 'pending', check_due_at = now()")
        db.verify_domain_claim(conn, db.claim_domain_check(conn), "second", 90)
        # A second live authorization for one scope is one nobody would ever think to revoke.
        assert len(_grants(conn, account)) == 1

    def test_one_account_s_proof_never_authorises_another(self, conn, account):
        # The load-bearing rule: "this ACCOUNT may actively grade this origin", never "this origin is
        # active-gradable". Alice verifying alice.com must leave Mallory exactly where she was.
        _accept_terms(conn, account)
        _claim(conn, account)
        db.verify_domain_claim(conn, db.claim_domain_check(conn), "both found", 90)

        mallory = conn.execute(
            "INSERT INTO auth.users (email) VALUES ('mallory@example.com') RETURNING id"
        ).fetchone()["id"]
        assert _grants(conn, mallory) == []


class TestExpiry:
    def test_a_claim_we_could_read_but_never_proved_is_failed(self, conn, account):
        cid = _claim(conn, account)
        db.record_domain_check(conn, cid, "not_found", "not_found", "neither published", 60)
        conn.execute("UPDATE domain_claims SET issued_at = now() - interval '30 days'")

        assert db.expire_stale_domain_claims(conn, 14) == 1

        assert _row(conn, cid)["status"] == "failed"

    def test_a_claim_we_could_only_ever_be_blocked_on_is_not_failed(self, conn, account):
        # Failing it would blame an owner for our own inability to reach them, which is the same
        # mistake in a different place.
        cid = _claim(conn, account)
        db.record_domain_check(conn, cid, "blocked", "blocked", "their WAF refused us", 900)
        conn.execute("UPDATE domain_claims SET issued_at = now() - interval '30 days'")

        assert db.expire_stale_domain_claims(conn, 14) == 0

        assert _row(conn, cid)["status"] == "pending"

    def test_one_factor_we_could_read_does_not_condemn_the_one_we_could_not(self, conn, account):
        # The case the seeded blocked/blocked test above cannot reach, and the one that was broken:
        # the predicate asked for EITHER factor to be conclusive, so a perfectly served file plus a
        # zone we never managed to query was enough to fail the claim. The owner did everything
        # right and was told at 14 days that their proofs were never found.
        cid = _claim(conn, account)
        db.record_domain_check(conn, cid, "ok", "blocked", "their nameserver SERVFAILed", 900)
        conn.execute("UPDATE domain_claims SET issued_at = now() - interval '30 days'")

        assert db.expire_stale_domain_claims(conn, 14) == 0

        assert _row(conn, cid)["status"] == "pending"

    def test_a_missing_dnspython_never_fails_an_owners_claim(self, conn, account):
        # Same shape, and the reason it is worth its own test: this one is OUR fault entirely. A
        # worker without dnspython reports every DNS factor as blocked for ever (see check_dns), so
        # under the old predicate a missing dependency on one box quietly failed every honest claim
        # whose file was serving correctly.
        cid = _claim(conn, account)
        db.record_domain_check(conn, cid, "ok", "blocked",
                               "DNS checking is unavailable on this worker", 900)
        conn.execute("UPDATE domain_claims SET issued_at = now() - interval '60 days'")

        assert db.expire_stale_domain_claims(conn, 14) == 0

    def test_the_other_way_round_is_also_spared(self, conn, account):
        cid = _claim(conn, account)
        db.record_domain_check(conn, cid, "blocked", "not_found", "their WAF refused the file", 900)
        conn.execute("UPDATE domain_claims SET issued_at = now() - interval '30 days'")

        assert db.expire_stale_domain_claims(conn, 14) == 0

        assert _row(conn, cid)["status"] == "pending"


class TestDegradingRatherThanCrashing:
    def test_a_missing_dns_library_blocks_the_factor_instead_of_taking_the_worker_down(self, monkeypatch):
        """A feature's optional dependency must not stop grading.

        Importing dnspython at module scope crash-looped the whole service on a box that had the new
        code and not the new package: grading, event checks and retries all died for a library one
        function uses. This asserts both halves of the fix, that the import is deferred and that the
        absence reads as 'we could not look' rather than 'your record is missing'.
        """
        import builtins

        real = builtins.__import__

        def without_dns(name, *args, **kwargs):
            if name.startswith("dns"):
                raise ModuleNotFoundError("No module named 'dns'")
            return real(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", without_dns)
        factor = verify_domain.check_dns("example.com", "sloptic-whatever")

        assert factor.status == "blocked"
        assert "dnspython" in factor.detail


class TestTheDnsQueryItself:
    def test_the_name_queried_is_absolute(self, monkeypatch):
        """A relative name inherits the host's search domains.

        The worker box's resolv.conf can carry `search something.example`, and without the trailing
        dot the stub would go looking for _sloptic.theirdomain.com.something.example and report an
        owner's perfectly correct record as missing. Absolute names cannot be suffixed.
        """
        seen = {}

        def fake(name):
            seen["name"] = name
            raise RuntimeError("stop here, the name is the whole assertion")

        monkeypatch.setattr(verify_domain, "_query_txt", fake)
        verify_domain.check_dns("example.com", "tok")

        assert seen["name"] == "_sloptic.example.com."


class TestPlatformSubdomainsAtGradeTime:
    def test_a_grant_for_a_platform_subdomain_does_not_authorise_an_active_grade(self, conn, account):
        """Structural, and asked again at the last possible moment.

        CLAUDE.md puts platform subdomains on the passive floor because the DNS factor lives in a
        zone the deployer does not hold, so a grant for one cannot have been earned the way the flow
        requires. The API refuses these when a claim is made; this catches a grant that predates a
        suffix being added to the list, or one written by hand.
        """
        origin = "https://team.vercel.app"
        conn.execute(
            "INSERT INTO grants (account_id, kind, scope, expires_at) "
            "VALUES (%s, 'app_origin', %s, now() + interval '90 days')",
            (account, origin),
        )
        gid = conn.execute(
            "INSERT INTO grades (origin, submitted_url, mode, status, account_id) "
            "VALUES (%s, %s, 'active', 'running', %s) RETURNING id",
            (origin, origin, account),
        ).fetchone()["id"]

        ok, why = db.may_grade_actively(conn, str(gid))

        assert ok is False
        assert "vercel.app" in why

    def test_an_ordinary_domain_with_the_same_grant_is_allowed(self, conn, account):
        # The guard must refuse the platform case only, not every origin grant.
        origin = "https://vibemill.dev"
        conn.execute(
            "INSERT INTO grants (account_id, kind, scope, expires_at) "
            "VALUES (%s, 'app_origin', %s, now() + interval '90 days')",
            (account, origin),
        )
        gid = conn.execute(
            "INSERT INTO grades (origin, submitted_url, mode, status, account_id) "
            "VALUES (%s, %s, 'active', 'running', %s) RETURNING id",
            (origin, origin, account),
        ).fetchone()["id"]

        assert db.may_grade_actively(conn, str(gid)) == (True, "")


class TestRecheckingTheProofsAtGradeTime:
    def _graded(self, conn, account, origin="https://example.com", run=None):
        return str(conn.execute(
            "INSERT INTO grades (origin, submitted_url, mode, status, account_id, event_run_id) "
            "VALUES (%s, %s, 'active', 'running', %s, %s) RETURNING id",
            (origin, origin, account, run),
        ).fetchone()["id"])

    def test_a_verified_origin_hands_back_the_proofs_to_re_read(self, conn, account):
        # A grant lasts 90 days, and inside that window a file can be deleted and a zone rebuilt
        # while the row still says verified. This is what lets the child ask the origin itself.
        _claim(conn, account, status="verified", token="sloptic-the-proof")
        conn.execute("UPDATE domain_claims SET verified_at = now()")
        gid = self._graded(conn, account)

        assert db.origin_proof_for_grade(conn, gid) == ("example.com", "sloptic-the-proof")

    def test_an_event_grade_has_nothing_to_re_read(self, conn, account):
        # Its authorization is the organizer's proof on the event pages, re-read on its own timer,
        # and there is no per-origin file to ask for.
        _claim(conn, account, status="verified")
        conn.execute("UPDATE domain_claims SET verified_at = now()")
        run = str(conn.execute(
            "INSERT INTO event_runs (account_id, slug, mode, status) "
            "VALUES (%s, 'hack', 'active', 'grading') RETURNING id", (account,)
        ).fetchone()["id"])
        gid = self._graded(conn, account, run=run)

        assert db.origin_proof_for_grade(conn, gid) is None

    def test_a_grant_with_no_claim_behind_it_has_nothing_to_re_read(self, conn, account):
        # Nothing to re-read is not the same as failing: a grant written outside this flow carries
        # no token, and inventing a refusal for it would break the organizer and admin paths.
        gid = self._graded(conn, account)

        assert db.origin_proof_for_grade(conn, gid) is None

    def test_another_account_s_proof_is_not_offered_for_this_grade(self, conn, account):
        # The proof has to belong to the account being authorised, or Mallory's grade would be
        # re-checked against Alice's token and pass.
        _claim(conn, account, status="verified", token="sloptic-alice")
        conn.execute("UPDATE domain_claims SET verified_at = now()")
        mallory = str(conn.execute(
            "INSERT INTO auth.users (email) VALUES ('mallory@example.com') RETURNING id"
        ).fetchone()["id"])
        gid = self._graded(conn, mallory)

        assert db.origin_proof_for_grade(conn, gid) is None


class TestStaleClaimsAreSweptUp:
    def test_the_sweep_is_actually_wired_into_the_supervisor(self):
        """It was written and never called, which is why this test looks at the source.

        Its event twin sits one line above it in the loop, which is exactly how the omission hid: the
        function existed, the tests exercised it directly, and nothing on the box ever ran it, so a
        claim nobody proved would re-check every five minutes for ever.
        """
        import inspect

        from sloptic_web_worker import __main__ as supervisor

        assert "expire_stale_domain_claims" in inspect.getsource(supervisor)


class TestWhichResolverDecidesAProof:
    def test_the_proof_is_put_to_public_resolvers_before_the_box_s_own(self, monkeypatch):
        """Proof of control is a question about the PUBLIC DNS.

        The worker box's router defers to an ISP resolver that answers FORMERR for every name that
        does not exist, rather than NXDOMAIN. That is the same family of behaviour as the NXDOMAIN
        hijacking ISPs are known for, and a resolver that invents answers for absent names is the
        wrong thing to ask whether an absent record is absent. A split-horizon or poisoned local
        resolver could also confirm a proof the rest of the world cannot see.
        """
        import dns.resolver

        asked = []

        class FakeResolver:
            def __init__(self):
                self.nameservers = ["from-the-network"]
                self.lifetime = None

            def resolve(self, name, rdtype, lifetime=None):
                asked.append(list(self.nameservers))
                return ["answer"]

        monkeypatch.setattr(dns.resolver, "Resolver", FakeResolver)
        monkeypatch.setattr(verify_domain.config, "VERIFY_DNS_RESOLVERS", ["9.9.9.9", "1.1.1.1"])

        assert verify_domain._query_txt("_sloptic.example.com.") == ["answer"]
        assert asked == [["9.9.9.9"]]

    def test_a_resolver_that_cannot_answer_is_skipped_rather_than_believed(self, monkeypatch):
        import dns.resolver

        asked = []

        class FakeResolver:
            def __init__(self):
                self.nameservers = ["from-the-network"]
                self.lifetime = None

            def resolve(self, name, rdtype, lifetime=None):
                asked.append(list(self.nameservers))
                if self.nameservers == ["9.9.9.9"]:
                    raise dns.resolver.NoNameservers("FORMERR")
                return ["answer from the second"]

        monkeypatch.setattr(dns.resolver, "Resolver", FakeResolver)
        monkeypatch.setattr(verify_domain.config, "VERIFY_DNS_RESOLVERS", ["9.9.9.9", "1.1.1.1"])

        assert verify_domain._query_txt("_sloptic.example.com.") == ["answer from the second"]
        assert asked == [["9.9.9.9"], ["1.1.1.1"]]

    def test_a_real_absence_is_believed_from_the_first_resolver(self, monkeypatch):
        # NXDOMAIN is an answer, and an honest resolver gives the same one. Asking the rest would
        # turn one true "no such record" into three queries.
        import dns.resolver

        calls = []

        class FakeResolver:
            def __init__(self):
                self.nameservers = []
                self.lifetime = None

            def resolve(self, name, rdtype, lifetime=None):
                calls.append(1)
                raise dns.resolver.NXDOMAIN("no such name")

        monkeypatch.setattr(dns.resolver, "Resolver", FakeResolver)
        monkeypatch.setattr(verify_domain.config, "VERIFY_DNS_RESOLVERS", ["9.9.9.9", "1.1.1.1"])
        factor = verify_domain.check_dns("example.com", "tok")

        assert factor.status == "not_found"
        assert len(calls) == 1

    def test_the_box_s_own_resolver_is_the_last_resort_not_the_first(self, monkeypatch):
        # A network that blocks public DNS must still work, so the system resolver is tried last
        # rather than not at all.
        import dns.resolver

        asked = []

        class FakeResolver:
            def __init__(self):
                self.nameservers = ["from-the-network"]
                self.lifetime = None

            def resolve(self, name, rdtype, lifetime=None):
                asked.append(list(self.nameservers))
                if self.nameservers != ["from-the-network"]:
                    raise dns.resolver.LifetimeTimeout("blocked")
                return ["the system resolver answered"]

        monkeypatch.setattr(dns.resolver, "Resolver", FakeResolver)
        monkeypatch.setattr(verify_domain.config, "VERIFY_DNS_RESOLVERS", ["9.9.9.9"])

        assert verify_domain._query_txt("_sloptic.example.com.") == ["the system resolver answered"]
        assert asked == [["9.9.9.9"], ["from-the-network"]]

    def test_nothing_answering_is_blocked_and_names_what_was_tried(self, monkeypatch):
        import dns.resolver

        class FakeResolver:
            def __init__(self):
                self.nameservers = []
                self.lifetime = None

            def resolve(self, name, rdtype, lifetime=None):
                raise dns.resolver.NoNameservers("FORMERR")

        monkeypatch.setattr(dns.resolver, "Resolver", FakeResolver)
        monkeypatch.setattr(verify_domain.config, "VERIFY_DNS_RESOLVERS", ["9.9.9.9"])
        factor = verify_domain.check_dns("example.com", "tok")

        assert factor.status == "blocked"
        assert "9.9.9.9" in factor.detail and "system" in factor.detail


class TestWatchingAVerifiedDomain:
    def test_a_verified_claim_comes_round_again(self, conn, account):
        # The proofs have to stay published, since every active grade re-reads them. A verified claim
        # that was never looked at again would let a domain go quietly unprovable until a grade
        # failed, which is the worst way for an owner to learn it.
        _accept_terms(conn, account)
        _claim(conn, account)
        db.verify_domain_claim(conn, db.claim_domain_check(conn), "both found", 90)
        conn.execute("UPDATE domain_claims SET check_due_at = now() - interval '1 minute'")

        again = db.claim_domain_check(conn)

        assert again is not None
        assert again.status == "verified"

    def test_a_verified_claim_is_watched_rather_than_chased(self, conn, account):
        """Both proofs hold, so nothing is learned by asking again soon, and this is somebody else's
        server we are fetching from.

        Asserted against the configured cadence rather than a number written out here. The previous
        version hard-coded "about a day" and then failed the moment the cadence was tuned, which
        tested my memory of the constant rather than the behaviour.
        """
        _accept_terms(conn, account)
        _claim(conn, account)
        db.verify_domain_claim(conn, db.claim_domain_check(conn), "both found", 90)

        seconds = float(conn.execute(
            "SELECT extract(epoch from (check_due_at - now())) AS s FROM domain_claims"
        ).fetchone()["s"])
        assert config.DOMAIN_WATCH_SECONDS - 60 <= seconds <= config.DOMAIN_WATCH_SECONDS
        # The property that actually matters: watching is far slower than repairing, or a healthy
        # domain would be polled as hard as a broken one.
        assert config.DOMAIN_WATCH_SECONDS > config.DOMAIN_REPAIR_SECONDS * 10

    def test_recording_a_look_never_touches_the_grant(self, conn, account):
        """The trap this design exists to avoid.

        Re-verifying on every daily look would upsert the grant with a fresh expires_at each time, so
        a grant would never expire and the 90 day time box would mean nothing: a domain that changed
        hands would keep its authorization for as long as the file and the record survived the
        handover. So a routine look RECORDS and nothing else.
        """
        _accept_terms(conn, account)
        _claim(conn, account)
        db.verify_domain_claim(conn, db.claim_domain_check(conn), "both found", 90)
        before = conn.execute("SELECT expires_at FROM grants WHERE account_id = %s", (account,)).fetchone()["expires_at"]

        db.record_domain_check(conn, _row_id(conn), "ok", "ok", "still there", 86400)

        after = conn.execute("SELECT expires_at FROM grants WHERE account_id = %s", (account,)).fetchone()["expires_at"]
        assert after == before

    def test_a_proof_that_vanished_is_reported_and_not_revoked(self, conn, account):
        # One bad look is a deploy or a WAF, not evidence that ownership ended. What changes is what
        # the owner SEES; the active grade re-checks both proofs itself and refuses on its own.
        _accept_terms(conn, account)
        _claim(conn, account)
        db.verify_domain_claim(conn, db.claim_domain_check(conn), "both found", 90)

        db.record_domain_check(conn, _row_id(conn), "not_found", "ok", "the file is gone", 3600)

        row = _row(conn, _row_id(conn))
        assert row["status"] == "verified"
        assert row["file_status"] == "not_found"
        assert len(_grants(conn, account)) == 1


def _row_id(conn):
    return str(conn.execute("SELECT id FROM domain_claims LIMIT 1").fetchone()["id"])
