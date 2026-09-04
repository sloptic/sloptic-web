-- Pause and cancel: an organizer must be able to stop what they started.
--
-- paused on the run stops the worker from CLAIMING any more of its grades; ones already running
-- finish (a grade is minutes, and killing children mid-flight is worse than letting them land).
-- Cancel is harder: the queued grades become 'cancelled' (a distinct status, not failed, since
-- "did not respond" would be a lie about who stopped), the entries' links to them are cleared so
-- those apps are gradeable again, and the run itself is marked cancelled.

alter table public.event_runs
  add column if not exists paused boolean not null default false;

alter table public.grades drop constraint if exists grades_status_check;
alter table public.grades
  add constraint grades_status_check check (status in ('queued', 'running', 'done', 'failed', 'cancelled'));

create index if not exists grades_event_run_queued_idx
  on public.grades (event_run_id)
  where status = 'queued';
