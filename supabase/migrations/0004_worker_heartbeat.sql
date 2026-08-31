-- Worker liveness, so a queued grade can say WHY it is waiting.
--
-- Without this a submitter cannot tell "two grades ahead of me" from "nothing is running", and both
-- look like a spinner that never resolves. A flat timeout cannot tell them apart either: a real
-- grade takes ~7 minutes, so a busy queue would false-expire jobs on a perfectly healthy system.
-- The worker writes here every poll, which is the only signal available when the queue is EMPTY
-- (nothing else in the schema updates when a healthy worker has nothing to do).

create table if not exists public.worker_status (
  id          text primary key default 'worker',   -- single row; a second worker would take its own id
  last_seen   timestamptz not null default now(),
  -- 'polling'  = claiming normally
  -- 'holding'  = alive but deliberately not claiming (daily budget spent, challenge breaker tripped)
  state       text not null default 'polling' check (state in ('polling', 'holding')),
  reason      text,                                 -- why it is holding, shown to nobody but logged
  in_flight   uuid                                  -- the grade being worked on, if any
);

alter table public.worker_status enable row level security;   -- service role only, like every other table

-- RLS alone is NOT enough, and forgetting this cost an evening: Supabase auto-grants privileges only
-- for objects created through its own migration flow, never for a table created over a raw pooler
-- connection, so without the line below every read 403s with "permission denied" and the site
-- concludes no worker is running. See 0005, which adds it. EVERY new table needs its own grant.
grant select, insert, update, delete on public.worker_status to service_role;

comment on table public.worker_status is
  'Heartbeat from the grade worker. Absence of a recent row means no worker is running, which is what
   lets a queued grade fail honestly instead of spinning forever.';
