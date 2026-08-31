-- Live progress for a running grade.
--
-- The grader already emits this and the worker was throwing it away: pipeline.run takes
-- on_progress(done, total, probe, outcomes) twice per probe, and on_phase(name, label, important)
-- at each phase boundary, where important=True marks a LONG otherwise-silent phase (Lighthouse's
-- two to three minute trace). Without surfacing it, a visitor watches an unchanging page for the
-- better part of ten minutes with no way to tell progress from a hang.
--
-- One jsonb rather than five columns: the shape is display-only, written every couple of seconds,
-- and never queried on. Nothing should join or filter on it.

alter table public.grades
  add column if not exists progress jsonb;

comment on column public.grades.progress is
  'Display-only liveness for a running grade: {phase, label, done, total, probe, at}. Written by the
   worker every couple of seconds from the grader''s on_progress/on_phase callbacks.';
