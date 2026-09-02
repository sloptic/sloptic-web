-- Grading a whole event: the run, its entries, and the lane the grades go in.
--
-- Two steps, not one button. The worker first RESOLVES the field (pull the gallery, find each team's
-- own app URL, screen out what must not be probed) and the organizer sees that list before anything
-- is graded. They are authorizing traffic at other people's apps, so they should see whose.

create table if not exists public.event_runs (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references auth.users(id) on delete cascade,
  slug         text not null,

  -- ONE tier per run, decided when it starts and never mixed. A board with some entries graded on 44
  -- checks and others on 102 is not a ranking, it is two measurements in one column, and they rank
  -- on different curves.
  mode         text not null check (mode in ('passive', 'active')),

  status       text not null default 'resolving'
                 check (status in ('resolving', 'ready', 'grading', 'done', 'failed', 'cancelled')),

  entries_found int,
  -- False when devpost.submissions raised Blocked partway: we have SOME of the gallery and must not
  -- present it as the field. An organizer ranking 40 of 60 entries without being told is worse than
  -- no board at all.
  gallery_complete boolean,
  detail       text,

  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz
);

create table if not exists public.event_entries (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.event_runs(id) on delete cascade,
  -- The Devpost submission page.
  project_url text not null,
  -- The address the TEAM published in their own app-links block, which is the provenance the consent
  -- chain wants: their declaration about their own work, not an organizer's list about them.
  app_url     text,
  -- NULL means gradeable. Otherwise why not: a vendor surface we must not probe, nothing deployed,
  -- or a team that asked to be left out.
  skip_reason text,
  grade_id    uuid references public.grades(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists event_entries_run_project_idx
  on public.event_entries (run_id, project_url);
create index if not exists event_entries_run_idx on public.event_entries (run_id);
create index if not exists event_runs_account_idx on public.event_runs (account_id, created_at desc);
create index if not exists event_runs_pending_idx on public.event_runs (created_at)
  where status in ('resolving', 'grading');

-- THE EVENT LANE. A field of 400 apps cannot go through the public queue: the site refuses past 30
-- waiting, the daily budget stops at 300, and even at 4 concurrent it would hold the anonymous tier
-- for most of a day. Tagging the grade with its run keeps the two separable, so the queue can refuse
-- depth on public submissions only and the worker can prefer a person waiting on one grade over an
-- event grinding through hundreds.
alter table public.grades
  add column if not exists event_run_id uuid references public.event_runs(id) on delete set null;

create index if not exists grades_public_queue_idx
  on public.grades (submitted_at)
  where status = 'queued' and event_run_id is null;

alter table public.event_runs    enable row level security;
alter table public.event_entries enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='event_runs'
                   and policyname='event_runs_self_read') then
    create policy event_runs_self_read on public.event_runs
      for select using (auth.uid() = account_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='event_entries'
                   and policyname='event_entries_self_read') then
    create policy event_entries_self_read on public.event_entries
      for select using (exists (
        select 1 from public.event_runs r where r.id = run_id and r.account_id = auth.uid()));
  end if;
end $$;

grant select, insert, update, delete on public.event_runs, public.event_entries to service_role;
grant select on public.event_runs, public.event_entries to authenticated;
