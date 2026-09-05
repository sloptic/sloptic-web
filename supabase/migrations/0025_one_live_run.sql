-- One live run per event per account, enforced by the database.
--
-- The API has always checked for a live run before starting another, but a check-then-insert races
-- with itself (two tabs, a double submit), and the check read the row with maybeSingle(), which
-- returns nothing at all once a duplicate exists, so the first duplicate let every later one
-- through. This makes the invariant the table's own.
--
-- If this fails on an existing database, duplicates are already there: resolve them (cancel the
-- extras) and re-run.

create unique index if not exists event_runs_one_live_idx
  on public.event_runs (account_id, slug)
  where status in ('resolving', 'ready', 'grading');
