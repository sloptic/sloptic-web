-- Let the worker say it is grading.
--
-- worker_status.state allowed only 'polling' and 'holding', from when the worker did one grade at a
-- time inside its poll loop. Concurrency added a 'grading' state and the constraint was never
-- widened, so EVERY heartbeat written while the worker was busy failed with a check violation. The
-- thread caught it, printed, and retried, so liveness froze for exactly as long as grading lasted
-- and the site told people "No grader is running" while it was running four of them.
--
-- The same shape as the Lighthouse loopback, the missing grant and the heartbeat thread before it:
-- the failure is invisible while idle and total while busy, so it only appears under load.
alter table public.worker_status drop constraint if exists worker_status_state_check;

alter table public.worker_status
  add constraint worker_status_state_check
  check (state in ('polling', 'holding', 'grading'));

comment on column public.worker_status.state is
  'polling: idle and claiming. grading: at least one grade in flight. holding: not claiming, with the
   reason in `reason`. Anything the worker can set must be listed here, or the heartbeat silently
   stops and the site reports the worker as dead.';
