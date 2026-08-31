-- Where a grade sits on the frozen reference curve.
--
-- Nullable on purpose: a percentile is CONTEXT, not the product. A grade with no curve configured,
-- or one the grader's rank() declines to place (mode mismatch, ineligible record), stores the score
-- and nothing here. The report reads "no population percentile" in that case, which is what it
-- already says today.
--
-- `curve_version` is not decoration: it records WHICH ruler produced the number, so a later curve
-- can never be mistaken for the one a stored percentile was computed against.

alter table public.results
  add column if not exists percentile      int,
  add column if not exists percentile_band text,
  add column if not exists curve_version   text,
  -- the full rank() payload: per-axis percentiles, absolute_gates, the reporting bundle. Kept whole
  -- so the report can show more later without a migration or a regrade.
  add column if not exists ranking         jsonb;

comment on column public.results.percentile is
  'Share of the reference population this app is cleaner than. LOW is good (lower slop is better).';
comment on column public.results.curve_version is
  'Version of the frozen curve this percentile was computed against, e.g. a passive-tagged CalVer.';
comment on column public.results.ranking is
  'Full sloptic benchmark.rank() output, including per-axis ranks and any absolute_gates.';
