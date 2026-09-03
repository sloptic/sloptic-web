-- Operator admin: an account-scoped privilege to run the ACTIVE battery on an event without an
-- organizer grant, for testing the product's active path on a real gallery before an organizer
-- exists. It is a superset of the passive override (0014): that one skips the ownership check but is
-- locked to passive; this one may also send the active battery.
--
-- WHY A SEPARATE COLUMN and not just widening `override`. The passive override MUST stay passive for
-- everyone who holds it, and the constraint below is what guarantees that. Admin is the one, named
-- exception, so it is recorded as its own fact: a board built this way is an operator test, never an
-- organizer-authorized grade, and the two must be distinguishable in the data forever.
--
-- Authorization is NOT this flag. The flag records that a run was CREATED under admin privilege; the
-- worker re-checks at grade time that the run's account is still on the admin allowlist
-- (SLOPTIC_ADMIN_ACCOUNTS), exactly as it re-checks a grant, because a privilege removed while a
-- field sits queued for hours must stop the next entry. The flag alone authorizes nothing.
alter table public.event_runs
  add column if not exists admin boolean not null default false;

-- An override run must be passive UNLESS it is an admin run. This preserves 0014's guarantee for the
-- plain passive override (not override or passive) and opens active for admin alone. A non-admin
-- override run that is active still violates the check and cannot be written.
alter table public.event_runs
  drop constraint if exists event_runs_override_is_passive;
alter table public.event_runs
  add constraint event_runs_override_is_passive
  check (not override or mode = 'passive' or admin);

comment on column public.event_runs.admin is
  'True when this run was created under operator admin privilege (SLOPTIC_ADMIN_ACCOUNTS), the only
   way an override run may be active. Re-checked against the live allowlist at grade time. A board
   with admin=true is an operator test, never an organizer-authorized grade.';
