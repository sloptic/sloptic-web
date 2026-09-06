-- "Your grade is ready", and one mail per event run rather than one per app.
--
-- A grade takes minutes and a field of 200 takes hours, so the page that says "this updates itself"
-- is asking someone to sit and watch. The mail exists so they do not have to.
--
-- Sent when the grade reaches `done`, regardless of whether a recovery pass is still booked. A
-- challenged grade can re-run its blocked tail 12 and 28 minutes later and move the score, so this
-- mail is a nudge to go and look rather than a statement of the final number: the report itself
-- says a pass is pending and when. Waiting for retries to settle would delay every challenged grade
-- by half an hour to avoid quoting a number the reader can see being updated.
alter table public.profiles
  -- Opt OUT. Someone who submitted a grade asked for its result, so the mail is expected; what they
  -- did not ask for is a setting they have to find and enable to be told their own work finished.
  add column if not exists notify_email boolean not null default true;

-- Sent-marks, not a queue. The worker looks for finished work with no mark and sends, so a crash
-- between send and mark costs a duplicate rather than a silence, which is the right way round.
alter table public.grades     add column if not exists notified_at timestamptz;
alter table public.event_runs add column if not exists notified_at timestamptz;

comment on column public.grades.notified_at is
  'When "your grade is ready" went out. Grades belonging to an event run are never marked here: a
   run sends ONE mail when the whole field is done, not one per app, so a 200-entry event is one
   message rather than two hundred.';

-- Partial and tiny: the only question is "finished, and not yet told", and almost every row is
-- either unfinished or long since sent.
create index if not exists grades_awaiting_notice
  on public.grades (finished_at)
  where status = 'done' and notified_at is null;

create index if not exists event_runs_awaiting_notice
  on public.event_runs (finished_at)
  where status = 'done' and notified_at is null;
