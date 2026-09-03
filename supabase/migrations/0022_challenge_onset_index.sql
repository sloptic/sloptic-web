-- How far a withheld grade got before the bot challenge, so "no score" can say "stopped at check
-- 47 of 102" instead of implying nothing ran.
--
-- The grader withholds a grade whose challenge onset landed before 60% of the battery
-- (_MIN_VALID_FRACTION), discarding the pre-onset outcomes and stamping challenge_stage='entry'. That
-- label reads as "first fetch, nothing ran", but the grade may have run for minutes. This stores the
-- onset probe's position in the run order, which is exactly how many checks completed before the
-- challenge tripped. NULL when no challenge fired, or a challenge fired on the first fetch with no
-- probe to attribute it to.
alter table public.results
  add column if not exists challenge_onset_index int;

comment on column public.results.challenge_onset_index is
  'Checks completed before the bot challenge tripped (the onset probe''s index in run order). Lets a
   withheld grade say how far it got. NULL when no challenge, or a literal first-fetch challenge.';
