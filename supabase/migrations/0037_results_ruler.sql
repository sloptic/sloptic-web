-- The ruler a grade was scored against, stored beside the score.
--
-- Sloptic 3.0.0 is a new ruler: full curve 2026.4 and passive curve passive-2026.2, and a 3.0 score
-- does not compare to a 2.x one. The grader stamps every record with `ruler: {full, passive}` at grade
-- time, never read from the current curve at render time, precisely so a STORED grade keeps saying
-- what it was measured against after the ruler moves again (4.0 is planned for December).
--
-- A column rather than a key read out of `card`. The card is a render artifact, and the site needs
-- the ruler in places that never load it: the report header, the grade lists, the boards, anywhere
-- two scores might sit side by side. And not `curve_version`, which is only written when ranking
-- SUCCEEDS; an unranked 3.0 grade still has a ruler, and losing it would leave it indistinguishable
-- from a 2.x one.
--
-- NULL means the grade predates the stamp. Every row written before this migration is a 2.x grade,
-- and the site must render NULL as "ruler unspecified", never as the current ruler. That is the
-- grader's own rule for a legacy card, and backfilling a guess here would break it.

alter table public.results
  add column if not exists ruler jsonb;

comment on column public.results.ruler is
  'The ruler stamped by the grader at grade time: {"full": "2026.4", "passive": "passive-2026.2"} for
   a 3.0 grade. NULL for any grade that predates the stamp, which the site must show as unspecified,
   never as current. A 3.0 score is not comparable to a 2.x one.';
