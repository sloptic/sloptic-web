-- Persist the grader's challenge signal, so a grade a WAF interrupted is never read as a clean one.
--
-- The grader already returns bot_challenge and challenge_stage (and, since 0018, blocked_probes and
-- incomplete_axes), but save_result dropped the first two on the floor. The cost of that was a grade
-- whose every probe a bot challenge blocked, nothing run, getting stored as slop 0 / status done,
-- which the event board then ranked as the cleanest app in the field. This is the exact "could not
-- observe it" -> "it is not there" failure the rest of the system is built to avoid.
--
-- challenge_stage == 'entry' means the challenge tripped on the FIRST fetch: nothing was graded, the
-- score is not a measurement, and the report must say so rather than show a 0. A later stage means
-- some probes ran before the block; those outcomes stand and the blocked tail is what retry_blocked
-- recovers.
alter table public.results
  add column if not exists bot_challenge boolean not null default false;
alter table public.results
  add column if not exists challenge_stage text;

comment on column public.results.bot_challenge is
  'True when a bot challenge / WAF interstitial fired during the grade. With an empty coverage and
   blocked_probes covering the whole battery it means the grade was WITHHELD: no score, never clean.';
comment on column public.results.challenge_stage is
  'Where the challenge tripped: "entry" (first fetch, nothing graded, withheld) or a later stage
   (some probes ran; the blocked tail is booked for retry). Empty when no challenge fired.';
