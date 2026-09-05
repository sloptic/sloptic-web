-- Make the per-address rate limit hold under concurrency.
--
-- allow() read the counter, awaited, then wrote it back. Twelve simultaneous submissions from one
-- address all read the same count and all passed, so the limit held only against traffic that was
-- already polite. It is the sole quota on an unauthenticated endpoint that makes the worker fetch a
-- caller-chosen URL, which is the one place a bypass costs real money and real outbound traffic.
--
-- INSERT ... ON CONFLICT DO UPDATE takes a row lock, so the increment and the read are one
-- statement and concurrent callers serialise behind it.
--
-- The refused attempt is counted too. A caller who keeps submitting past the limit is exactly who
-- the window is for, and not counting them makes the window restart cheaper the harder it is
-- pushed.

create or replace function public.bump_rate_limit(
  p_ip_hash text,
  p_window_start timestamptz,
  p_max int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into public.rate_limits (ip_hash, window_start, count)
       values (p_ip_hash, p_window_start, 1)
  on conflict (ip_hash, window_start)
    do update set count = rate_limits.count + 1
    returning count into new_count;

  return new_count <= p_max;
end;
$$;

comment on function public.bump_rate_limit(text, timestamptz, int) is
  'Charges one request against an address''s window and says whether it is allowed. Atomic: the
   increment and the verdict are one statement, unlike the read-modify-write it replaces.';

grant execute on function public.bump_rate_limit(text, timestamptz, int) to service_role;
