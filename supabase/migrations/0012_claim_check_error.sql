-- A fourth check state: 'error', meaning WE failed, not Devpost.
--
-- The three states came from sloptic.devpost and describe what the remote said. When the worker
-- itself raised, the only honest-looking slot was 'blocked', so a NameError in our own code was
-- reported to an organizer as "Devpost did not answer our last check". That is the same
-- misattribution this schema was written to prevent, pointed the other way: we blamed the remote for
-- a fault of ours, and the person reading it could do nothing about either.
alter table public.event_claims
  drop constraint if exists event_claims_check_status_check;

alter table public.event_claims
  add constraint event_claims_check_status_check
  check (check_status in ('ok', 'not_found', 'blocked', 'error'));

comment on column public.event_claims.check_status is
  'What the LAST check saw. ok / not_found / blocked come from sloptic.devpost and describe the
   remote; error means the worker itself failed and the detail carries the exception. Never collapse
   these: only not_found means the token is absent, and only blocked means Devpost would not answer.';
