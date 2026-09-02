-- The Lighthouse performance score, lifted out of the outcomes blob.
--
-- It already exists on every grade, inside perf-lighthouse-001's evidence, but reading it there means
-- pulling the whole outcomes array: about 150 probe records with their evidence, per app. Fine for
-- one report, tens of megabytes for a 200 app event board that wants one number each.
alter table public.results
  add column if not exists lighthouse_score int;

comment on column public.results.lighthouse_score is
  'Google Lighthouse performance score, 0-100, higher is better. NULL when Lighthouse did not run or
   the grade predates this column. Copied from perf-lighthouse-001 evidence at save time.';
