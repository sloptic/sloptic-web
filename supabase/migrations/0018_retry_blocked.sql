-- Recover the probes a WAF challenged mid-grade.
--
-- A challenge does not fail a grade, it truncates it: the probes that never ran are recorded in
-- blocked_probes and read as N/A. That is lost recall wearing the clothes of a clean result, and on
-- an active grade the blocked tail is usually the injection and upload families, which is exactly
-- the part an active grade exists for.
--
-- The recovery is a SECOND PASS, not a retry of the whole grade: re-run only the blocked ids once
-- the block has cleared (Vercel's is about ten minutes), then fold the outcomes back in. It cannot
-- be inline, because holding a grading slot idle for ten minutes would blow the deadline and the
-- slot both.
alter table public.results
  -- The tail this grade never got to. Empty means nothing was blocked.
  add column if not exists blocked_probes text[] not null default '{}',
  add column if not exists incomplete_axes text[] not null default '{}';

alter table public.grades
  -- When the blocked tail is worth another attempt, and how many passes it has had. NULL means no
  -- recovery is pending, which is the ordinary case.
  add column if not exists retry_due_at timestamptz,
  add column if not exists retry_passes int not null default 0;

create index if not exists grades_retry_due_idx
  on public.grades (retry_due_at)
  where retry_due_at is not null;

comment on column public.grades.retry_due_at is
  'When the WAF-blocked probe tail should be re-run. Set after a grade that recorded blocked probes,
   cleared once recovered or once the passes run out. Not a re-grade: only the blocked ids re-run.';
