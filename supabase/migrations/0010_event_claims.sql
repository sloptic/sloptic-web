-- Organizer event verification: the claim, and the check that settles it.
--
-- An organizer proves they run a Devpost event by publishing a token we issue as a "Grading policy"
-- link on the event's OWN pages, which only its admins can edit. We read it back off the pinned host
-- and, if it is there, write the account-bound grant in `grants`.
--
-- WHY THIS IS A JOB AND NOT A ROUTE HANDLER. The check is an outbound fetch, and this project has two
-- standing rules that both point the same way: every outbound fetch goes through the egress sandbox,
-- which lives on the worker, and the worker sits on a residential connection because datacenter IPs
-- get challenged by exactly the kind of WAF Devpost runs. A Vercel route would be off-sandbox and on
-- the wrong side of that WAF, and a WAF block is the one answer this flow must never misread.

create table if not exists public.event_claims (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references auth.users(id) on delete cascade,
  -- The Devpost slug, which is also a DNS label: <slug>.devpost.com. Validated by
  -- sloptic.devpost.pinned_host() before any fetch, never string-built here.
  slug         text not null,

  -- What the organizer publishes. PUBLIC BY DESIGN, and not a secret: it ends up on a public rules
  -- page and in a URL participants are meant to follow. Its security is positional, not textual. The
  -- proof is that THIS token appeared on THAT event's own pages, which needs admin rights there.
  -- Someone reading Alice's token learns nothing they can use: their own claim carries a different
  -- token, and publishing it still means editing Alice's event.
  token        text not null unique,

  status       text not null default 'pending'
                 check (status in ('pending', 'verified', 'failed', 'revoked')),

  -- The LAST CHECK's tri-state, straight from sloptic.devpost, kept apart from `status` on purpose.
  -- 'blocked' means we could not look, which is not 'not_found'. Collapsing the two would tell an
  -- organizer their token is missing when the truth is that Devpost would not answer us.
  check_status text check (check_status in ('ok', 'not_found', 'blocked')),
  check_detail text,        -- devpost's own `detail`. Record it, never parse it.

  -- Set when the worker should look again. A claim is picked up when this is due, which is what makes
  -- a blocked check retry later instead of failing the organizer.
  check_due_at timestamptz not null default now(),
  attempts     int not null default 0,

  issued_at    timestamptz not null default now(),
  checked_at   timestamptz,
  verified_at  timestamptz
);

-- One live claim per account per event. Re-claiming refreshes rather than accumulating, and two
-- accounts may both hold a pending claim on the same slug: only the one that actually publishes its
-- token verifies, which is the scheme working rather than a race to reserve a name.
create unique index if not exists event_claims_account_slug_idx
  on public.event_claims (account_id, slug)
  where status in ('pending', 'verified');

-- The worker's claim query: what is due for a look.
create index if not exists event_claims_due_idx
  on public.event_claims (check_due_at)
  where status = 'pending';

alter table public.event_claims enable row level security;

-- An account may read its own claims and nothing else. Writes are server side only: a claim that
-- could set its own status to 'verified' would be the whole control undone.
create policy event_claims_self_read on public.event_claims
  for select using (auth.uid() = account_id);

-- Supabase does not auto-grant for objects created over a raw pooler connection (see 0001 and 0005).
grant select, insert, update, delete on public.event_claims to service_role;
grant select on public.event_claims to authenticated;

comment on table public.event_claims is
  'A pending or settled attempt to prove control of a Devpost event. The durable authorization is the
   row it writes in `grants` (kind = organizer_event), never this row.';
