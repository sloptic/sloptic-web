-- Grade ownership and report retention.
--
-- Two problems, one shape. A grade has never had an owner, so the only way back to one is the URL,
-- and nothing has ever expired, so every report lives forever. The second is the reason the first
-- matters: anonymous callers may grade apps they do NOT own (passive is legal precisely because it
-- reads only what any visitor sees), and the stored report is a durable, shareable inventory of a
-- third party's weaknesses that they never asked for and cannot revoke. Having LOOKED is not the
-- same act as keeping the writeup online indefinitely.
--
-- So: an owner is optional, and the report body of an UNOWNED grade expires. The `grades` row itself
-- is kept either way (rate limiting, abuse forensics, population statistics), because none of those
-- need the finding list, only the score.

-- Optional owner. ON DELETE SET NULL, not CASCADE: deleting an account should not silently destroy
-- the rate-limiting and abuse history attached to grades it once claimed. The grades revert to
-- anonymous, which means the sweep below reaches their reports on the normal schedule.
alter table public.grades
  add column if not exists account_id uuid references auth.users(id) on delete set null;

create index if not exists grades_account_idx
  on public.grades (account_id, submitted_at desc)
  where account_id is not null;

-- The sweep reads this every run, so keep it narrow: only unowned grades are ever candidates.
create index if not exists grades_unowned_finished_idx
  on public.grades (finished_at)
  where account_id is null;

-- Drop the report body of unowned grades past the window, leaving the grade row.
--
-- 30 days is deliberate, and stricter than it may look next to WebPageTest, whose comparable
-- "30 days" is a cap on a browser-local history list while the results themselves sit on their
-- servers for about 13 months. Theirs can be: a performance timing is not an attack surface
-- inventory, and it decays into irrelevance on its own. Ours does neither.
--
-- The default is mirrored by ANON_REPORT_DAYS in web/lib/retention.ts. Change both together.
create or replace function public.expire_anonymous_reports(retain_days int default 30)
returns int
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.results r
     using public.grades g
     where r.grade_id = g.id
       and g.account_id is null
       and g.finished_at is not null
       and g.finished_at < now() - make_interval(days => retain_days)
    returning 1
  )
  select count(*)::int from gone;
$$;

-- The hashed IP is the only quasi-identifier in the schema and it outlives its purpose fast: rate
-- limiting looks back hours, not months. Forget it well before the report goes.
create or replace function public.forget_submitter_ips(retain_days int default 2)
returns int
language sql
security definer
set search_path = public
as $$
  with gone as (
    update public.grades
       set submitter_ip_hash = null
     where submitter_ip_hash is not null
       and submitted_at < now() - make_interval(days => retain_days)
    returning 1
  )
  select count(*)::int from gone;
$$;

comment on function public.expire_anonymous_reports(int) is
  'Deletes the results row of grades no account has claimed once they pass the retention window.
   Keeps the grades row. Called by the worker maintenance tick; safe to run repeatedly.';

grant execute on function public.expire_anonymous_reports(int) to service_role;
grant execute on function public.forget_submitter_ips(int)     to service_role;
