-- Mark a run that skipped the ownership check.
--
-- The operator can start a run on an event nobody has verified, which is how the flow gets tested on
-- a real gallery before any organizer exists. It is recorded on the row rather than left implicit,
-- because a board built this way must never be mistaken later for one an organizer authorized.
--
-- An override run is PASSIVE, enforced in the route and again by this constraint. Batch passive
-- grading of public URLs is what the single URL form already does, one at a time, so the override
-- buys convenience and no new capability. Active probing of a stranger's entries is the
-- unauthorized testing the tier model exists to prevent, and no debug flag reaches it.
alter table public.event_runs
  add column if not exists override boolean not null default false;

alter table public.event_runs
  drop constraint if exists event_runs_override_is_passive;
alter table public.event_runs
  add constraint event_runs_override_is_passive
  check (not override or mode = 'passive');

comment on column public.event_runs.override is
  'True when this run skipped the organizer ownership check via SLOPTIC_EVENT_OVERRIDE. Always
   passive: the constraint enforces what the route intends. Never present such a board as authorized.';
