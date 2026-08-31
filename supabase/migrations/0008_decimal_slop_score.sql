-- slop_score was `int`, which threw away the decimal at write time.
--
-- The grader emits a damped float: an app whose axes read qa 8.8 + security 12.8 has a score of
-- 21.6, and storing it as an integer wrote 22. The schema's own comment says axis_slop sums to
-- slop_score, and with rounding it did not. Worse, the axes were stored as jsonb and kept their
-- decimals, so the report showed a headline that its own breakdown contradicted.
--
-- numeric, not float8: these are prices on a fixed scale, and a base-2 float would reintroduce a
-- different rounding problem (0.1 + 0.2) on a number people compare.

alter table public.results
  alter column slop_score type numeric using slop_score::numeric;

comment on column public.results.slop_score is
  'Damped total, lower is better. NUMERIC because the grader emits a decimal and axis_slop must sum
   to exactly this; rounding it to int made the headline disagree with its own breakdown.';
