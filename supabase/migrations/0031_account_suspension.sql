-- Turning off ONE account, without turning off everyone.
--
-- The controls before this were a global kill switch (GRADING_OPEN=0) and per-IP rate limits.
-- Neither answers the case they need to: one signed-in account behaving badly. The rate limit is
-- keyed on address, which a signed-in abuser changes for free, and the kill switch stops every
-- honest user in order to stop one. So the only real response was editing rows by hand under
-- pressure, which is how a wrong row gets edited.
--
-- Suspension, not deletion. The account keeps its grades, its grants and its history: the point is
-- to stop it costing us outbound traffic, not to destroy the record of what it did. Reversible by
-- setting the column back to null, which matters when the first use of a control like this is
-- usually a mistake.
alter table public.profiles
  add column if not exists suspended_at     timestamptz,
  -- Shown to the account, so it has to read as a sentence to a person rather than as an incident
  -- note to ourselves. Null falls back to a generic line in the UI.
  add column if not exists suspended_reason text;

comment on column public.profiles.suspended_at is
  'Set to suspend the account: it may still sign in and read its own reports, but may not start a
   grade, an event run, or a domain verification. Cleared by setting it back to null. Checked at
   every entry point in web/ AND again in the worker, because a grade queued before the suspension
   is traffic that has not been sent yet.';

-- Partial: almost every row is null, and the only question ever asked is "is this one set".
create index if not exists profiles_suspended
  on public.profiles (suspended_at)
  where suspended_at is not null;
