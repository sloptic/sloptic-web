-- Refreshing a gallery reports what changed.
--
-- refresh_requested marks a run the organizer re-verified deliberately, so the worker resolves it
-- in REFRESH mode: every submission is re-fetched and compared with the cached copy, rather than
-- served from cache. The counts land on the run afterwards and are shown until the next refresh.
-- Null means this run has never been refreshed; a first resolve says nothing about "new" because
-- to a first resolve everything is new.

alter table public.event_runs
  add column if not exists refresh_requested boolean not null default false,
  add column if not exists refresh_new_submissions int,
  add column if not exists refresh_modified_submissions int;
