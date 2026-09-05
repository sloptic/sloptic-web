-- Correct the percentile column comment, which described the other column.
--
-- 0003 said "Share of the reference population this app is cleaner than. LOW is good (lower slop is
-- better)." Those two halves describe different columns. sloptic's benchmark._rank_on_dist returns
-- (percentile, cleaner_than_pct) as "the share strictly BETTER" and "the share strictly worse", so
-- the first sentence is the definition of cleaner_than_pct and only the parenthetical belongs to
-- percentile. lib/grades.ts has always read it correctly; the comment is what would mislead the
-- next person to code against this table.

comment on column public.results.percentile is
  'Share of the reference population that scored strictly BETTER than this app, from
   sloptic benchmark.rank(). LOW is good. The complement, the share that scored worse, is
   cleaner_than_pct inside the ranking jsonb; the two are not complements when scores tie, because
   a tie group counts toward neither.';
