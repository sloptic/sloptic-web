-- Renewing a verified domain, which until now was impossible.
--
-- A grant lasts GRANT_DAYS (90). Nothing moved a claim out of 'verified', and the daily watch
-- deliberately records a look WITHOUT re-granting (or a grant would never expire and the time box
-- would mean nothing). Between those two facts there was no path at all: on day 91 the account page
-- still said Verified with the active button enabled, POST /api/grade answered 403, and "Check
-- again" reached the watch branch and changed nothing, for ever. The only escape was to give the
-- domain up and re-add it, which issues a NEW token and asks the owner to republish a file and a DNS
-- record that were both already correct.
--
-- The renewal is an explicit act by the account, not a side effect of a passing check, and that is
-- the whole design. Auto-renewing on a healthy look would make the 90 days decorative: the proofs
-- would carry the grant for ever as long as the file stayed up, and the attestation ("I own this and
-- authorize active testing") would never be re-affirmed by a person. CLAUDE.md lists that
-- attestation among the layers the active tier rests on, so re-affirming it is the point of the
-- expiry, not a formality around it.
--
-- Flagged here rather than in a new table: the flag is per claim, read on the same row the checker
-- already holds, and cleared in the same transaction that writes the grant.
alter table public.domain_claims
  add column if not exists renew_requested_at timestamptz;

comment on column public.domain_claims.renew_requested_at is
  'Set when the owner re-attests and asks for another term. The worker upserts the grant on the next
   check where BOTH proofs answer ok, then clears this. Null means a passing check records the look
   and nothing more, which is what keeps the 90 day box real.';

-- Partial: the checker only ever asks for rows that are set, and the column is null for almost every
-- claim almost all of the time.
create index if not exists domain_claims_renew_requested
  on public.domain_claims (renew_requested_at)
  where renew_requested_at is not null;
