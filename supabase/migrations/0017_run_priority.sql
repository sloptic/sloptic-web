-- Grade the events that need it first.
--
-- Runs drain FIFO, so an organizer judging tonight queues behind someone re-grading last year's
-- hackathon. Devpost publishes no award announcement date, so this does NOT try to schedule against
-- a ceremony time: submission_period_dates and time_left_to_submission are display strings with no
-- timezone, and the grader's own note is that parsing them is advisory at best.
--
-- Two booleans do the job instead, and they are exact:
--   0  submissions ended, winners not announced  -> judging is happening NOW
--   1  still open or upcoming, winners not announced -> the deadline is ahead of them
--   2  winners announced -> retrospective, nobody is waiting on it
-- Lower is sooner. Default 1, so a run whose state we could not read is treated as ordinary rather
-- than jumped to the front or buried.
alter table public.event_runs
  add column if not exists priority int not null default 1;

comment on column public.event_runs.priority is
  'Scheduling urgency from the event''s own state at resolve time. 0 judging now, 1 deadline ahead,
   2 winners already announced. Not a deadline: Devpost does not publish one.';
