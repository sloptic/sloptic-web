-- Do not mail people about work that finished before the mail existed.
--
-- 0032 added notified_at as NULL, which is correct for new rows and wrong for every row already in
-- the table: it made the entire back catalogue of finished grades and settled runs "finished, and
-- not yet told". With a key configured the worker would work through all of it, ten per pass, every
-- five seconds, telling people about grades they ran weeks ago and spending a daily sending cap to
-- do it.
--
-- Marked as told rather than as skipped, because the sent-mark is the only state there is and
-- inventing a second one to mean "deliberately silent" would complicate every query that reads it
-- for the sake of history nobody is waiting on.
--
-- This should have been part of 0032. It is separate because 0032 was already applied.
update public.grades
   set notified_at = now()
 where status = 'done' and notified_at is null;

update public.event_runs
   set notified_at = now()
 where status = 'done' and notified_at is null;
