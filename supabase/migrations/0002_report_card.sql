-- Store what the grader already produces but the lean benchmark record throws away.
--
-- `_grade_record` exists to feed benchmark ranking, so it keeps only the checks that FIRED. A report
-- wants more than a list of complaints: what a passing check measured, and how to fix a failing one.
-- All three columns come from the grader's own public API, not from re-deriving anything here.

alter table public.results
  -- reportcard.build_card(): per finding, what was expected, what was seen, what it means, and the fix.
  add column if not exists card jsonb,
  -- every outcome, not just failures, with the evidence each one recorded. This is what lets a passing
  -- check say what it measured rather than showing a bare name.
  add column if not exists outcomes jsonb,
  -- per axis, the damped score this app WOULD have carried if every applicable check had fired.
  -- Computed with the grader's own aggregator, so the damping matches the real score exactly.
  add column if not exists axis_potential jsonb;

comment on column public.results.card is
  'sloptic.reportcard.build_card() output: axis sections with expected/actual/indicates/remediation.';
comment on column public.results.outcomes is
  'Every Outcome from the run (slop_detected, clean, not_applicable) with its evidence.';
comment on column public.results.axis_potential is
  'Per-axis damped worst case over the checks that applied. Always >= the matching axis_slop.';
