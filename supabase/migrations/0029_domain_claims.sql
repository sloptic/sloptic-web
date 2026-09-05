-- Owner verification: prove you control an origin, and get an ACCOUNT-BOUND grant to grade it
-- actively. The tier the homepage has been advertising and could not deliver.
--
-- WHY A JOB AND NOT A ROUTE, same as 0010: both proofs are outbound fetches, every outbound fetch
-- goes through the egress sandbox, and the sandbox lives on the worker. A Vercel route would be off
-- sandbox, and one of the two factors is a DNS lookup whose answer decides whether we later aim
-- attack payloads at a stranger's server. That is not a decision to make from an unguarded process.
--
-- TWO INDEPENDENT FACTORS, and the independence is the point (CLAUDE.md):
--   file: https://<origin>/.well-known/sloptic-verification.txt  -> proves control of what is SERVED
--   dns:  TXT _sloptic.<host>                                    -> proves control of the ZONE
-- Two files at two paths would be one factor twice. An attacker with an open upload or a subdomain
-- takeover can plant a file; planting a TXT record needs the zone. Both are re-checked before an
-- active grade, so a lapsed domain cannot keep an old grant alive.
--
-- The grant this produces is account-bound and origin-scoped. Alice verifying alice.com authorizes
-- ALICE to actively grade alice.com. Mallory submitting alice.com still gets the passive floor,
-- because the question asked at grade time is "does THIS account hold a grant for this origin", never
-- "is this origin verified".

create table if not exists public.domain_claims (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references auth.users(id) on delete cascade,

  -- Scheme, host and port, normalized by the API before it ever lands here, because the grant that
  -- comes out of this is scoped to exactly this string and a grade compares against it.
  origin       text not null,
  -- The registrable host on its own, so the DNS factor never has to parse the origin back apart.
  host         text not null,

  -- What the owner publishes, in both places. World readable and that is fine: reading Alice's token
  -- confers nothing, because Mallory's own claim carries a different one and publishing Alice's still
  -- means controlling Alice's server AND Alice's zone. Unguessable per claim so nobody can pre-place
  -- a token against a domain they are about to be asked about.
  token        text not null unique,

  status       text not null default 'pending'
                 check (status in ('pending', 'verified', 'failed', 'revoked')),

  -- Each factor's LAST look, tri-state and kept apart from `status`, which is the lesson 0010 wrote
  -- down and sloptic.devpost exists to enforce: 'blocked' means WE COULD NOT LOOK. A timeout, a WAF,
  -- a 5xx or a DNS SERVFAIL is not absence. Telling an owner their token is missing when the truth is
  -- that their server would not answer us is the bug this shape prevents.
  file_status  text check (file_status in ('ok', 'not_found', 'blocked')),
  dns_status   text check (dns_status  in ('ok', 'not_found', 'blocked')),
  detail       text,

  check_due_at timestamptz not null default now(),
  attempts     int not null default 0,

  -- The attestation, recorded because it is what makes an active grade lawful rather than merely
  -- technically possible. Not a checkbox we forget: the row cannot exist without a time on it.
  attested_at  timestamptz not null default now(),
  attested_ip_hash text,

  issued_at    timestamptz not null default now(),
  checked_at   timestamptz,
  verified_at  timestamptz
);

-- One live claim per account per origin. A second attempt reuses the row rather than racing it, the
-- same invariant 0025 makes for runs.
create unique index if not exists domain_claims_account_origin_idx
  on public.domain_claims (account_id, origin)
  where status in ('pending', 'verified');

-- The worker's poll: the oldest claim that is due.
create index if not exists domain_claims_due_idx
  on public.domain_claims (check_due_at)
  where status = 'pending';

alter table public.domain_claims enable row level security;
-- No policies, deliberately, exactly as 0001 does: only the service role reaches this table, and the
-- API routes are what decide who may see which row.

grant select, insert, update, delete on public.domain_claims to service_role;
grant select on public.domain_claims to authenticated;

comment on table public.domain_claims is
  'Owner verification claims. Two independent proofs (a served file and a DNS TXT record) settle one
   claim; success writes an account-bound app_origin grant. Verification runs on the worker because
   both proofs are outbound fetches and the egress sandbox lives there.';
