-- A share link is its own capability, separate from the report URL.
--
-- The report id is the whole of a report's access control: holding /grade/<id> is read access to
-- every finding, and while no account has claimed the grade it is also the right to DELETE it (the
-- takedown route for someone graded without asking). A score posted to X, Reddit or a Discord must
-- hand out neither. So a grade carries a second random token, minted the first time someone shares
-- it, and /s/<token> shows the summary only: origin, score, placement, axis subtotals, mode, ruler.
-- Nothing about the token leads back to the report id.
--
-- Nullable and minted lazily: most grades are never shared, and a token that exists is a link that
-- works. Unique where set, so two grades can never answer to one share link. The row's own delete
-- (and the anonymous-report expiry, which deletes results) takes the share with it.

alter table public.grades add column if not exists share_token text;

create unique index if not exists grades_share_token_key
  on public.grades (share_token)
  where share_token is not null;
