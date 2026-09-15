-- Say WHY grading is off, from the machine that turned it off.
--
-- The site can already tell that the worker is gone: it heartbeats every 15s and the read path calls
-- a heartbeat older than 90s dead. What it cannot tell is the difference between "the box crashed at
-- 3am" and "the corpus is being re-run and this is a planned week", and those deserve very different
-- sentences. The v3 sprint is 7.6 days of box time with the grader down, so the generic answer would
-- be on screen for a week.
--
-- In the DATABASE rather than an env var because of who needs to write it. The operator turning the
-- worker off is on the box over a VPN with a shell, not in a Vercel dashboard, and an env var means a
-- redeploy to say a sentence and another to take it back. The box already holds DATABASE_URL, so this
-- is one statement in the same script that runs systemctl.
--
-- Its own column, not `reason`: the heartbeat overwrites reason on every beat, and this has to
-- survive the worker stopping, which is the entire moment it exists for.

alter table public.worker_status
  add column if not exists paused_note text;

comment on column public.worker_status.paused_note is
  'Operator message shown when grading is unavailable, e.g. "down for the corpus re-run, back next
   week". Set before stopping the worker and cleared after starting it, by worker/deploy/maintenance.sh.
   NULL means no message, and the site falls back to a generic one. Never written by the heartbeat, so
   it outlives the process that grading depends on.';
