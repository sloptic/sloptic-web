"""Owner verification: the two proofs, and the grant they earn.

The grant this produces is what lets attack payloads be aimed at a server, so the questions here are
about who gets one and who does not, and about the difference between a proof that is ABSENT and a
proof we could not LOOK at.
"""
from __future__ import annotations

from sloptic_web_worker import db, verify_domain


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

    def test_only_pending_claims_are_checked(self, conn, account):
        for status in ("verified", "failed", "revoked"):
            conn.execute("TRUNCATE domain_claims CASCADE")
            _claim(conn, account, status=status)
            assert db.claim_domain_check(conn) is None


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
