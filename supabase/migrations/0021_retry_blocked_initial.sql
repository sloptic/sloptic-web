-- How many probes were blocked when recovery began, so the report can say "recovered P of M".
--
-- blocked_probes only ever holds what is STILL blocked, and it shrinks as passes recover the tail,
-- so the original count is gone the moment the first pass lands. This keeps it. NULL until a
-- recovery pass has run, which is the ordinary case (nothing blocked, or blocked but not yet retried).
alter table public.results
  add column if not exists retry_blocked_initial int;

comment on column public.results.retry_blocked_initial is
  'The blocked-probe count when the first recovery pass ran, kept so partial recovery can be shown as
   "recovered P of M". NULL before any pass. blocked_probes holds only what is still blocked.';
